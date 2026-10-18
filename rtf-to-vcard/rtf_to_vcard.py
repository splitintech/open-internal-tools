#!/usr/bin/env python3
"""Convert TXT/CSV/TSV columns, HTML tables, or labeled RTF contacts to vCard 3.0."""

import argparse
import csv
import json
import io
import unicodedata
import re
import sys
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote


SCHEMA = json.loads(Path(__file__).with_name("field-schema.json").read_text(encoding="utf-8"))
EXPORT_SCHEMA = json.loads(Path(__file__).with_name("export-schema.json").read_text(encoding="utf-8"))


def normalize_header(value):
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"[-_‐‑‒–—−]", " ", value)
    return re.sub(r"[\s\ufeff]+", " ", value).strip()


ALIASES = {normalize_header(alias): field for field, aliases in SCHEMA["fields"].items() for alias in aliases}
LABEL = re.compile(r"^([^:\t]+?)\s*(?::|\t)\s*(.*)$")


class ConversionError(ValueError):
    def __init__(self, issues):
        self.issues = issues
        self.code = issues[0]["code"]
        message = "\n".join(issue["message"] for issue in issues[:20])
        if len(issues) > 20:
            message += f"\n{len(issues) - 20} more errors. Fix these and try again."
        super().__init__(message)


def fail(code, message, **location):
    raise ConversionError([dict(code=code, message=message, **location)])


def location_text(row, table=None):
    return f"HTML table {table}, row {row}" if table else f"Line {row}"


def normalize_input(text):
    text = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    if re.search(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", text):
        fail("INVALID_ENCODING", "Save your file as UTF-8 text without binary/control characters and try again.")
    if not text.strip():
        fail("EMPTY_FILE", "This file is empty. Add a header row and at least one contact.")
    return text


def fields_for(header, row=1, table=None):
    if not header:
        fail("INVALID_HEADER", "Add a header row with a label for each column.", row=row, table=table)
    fields, seen, issues = [], {}, []
    for index, label in enumerate(header):
        normalized = normalize_header(label)
        field = ALIASES.get(normalized)
        key = f"field:{field}" if field else f"extra:{normalized}"
        if not normalized:
            issues.append(dict(code="INVALID_HEADER", message=f"{location_text(row, table)}, column {index + 1}: add a column label.", row=row, column=index + 1, table=table))
        elif key in seen:
            prior = seen[key]
            issues.append(dict(code="DUPLICATE_HEADER", message=f"{location_text(row, table)}: columns {prior + 1} ({header[prior].strip()}) and {index + 1} ({label.strip()}) map to the same field. Use one column per field.", row=row, column=index + 1, table=table))
        else:
            seen[key] = index
        fields.append((label.strip(), field))
    if issues:
        raise ConversionError(issues)
    return fields


def conversion_warnings(generated, extras):
    warnings = []
    if generated:
        warnings.append(dict(code="GENERATED_NAMES", count=generated, message=f"{generated} contact(s) use a name generated from Company, Email, Phone, Website, or “Unnamed contact”."))
    if extras:
        warnings.append(dict(code="EXTRA_COLUMNS", count=len(extras), columns=extras, message=f"{len(extras)} extra column(s) preserved as labeled Notes: {', '.join(extras)}."))
    return warnings


def convert_tables(tables):
    contacts, issues, extra_columns = [], [], []
    generated = 0
    for table in tables:
        fields = fields_for(table["header"], table["header_line"], table.get("table"))
        for row, cells in table["rows"]:
            location = location_text(row, table.get("table"))
            if len(cells) != len(fields):
                issues.append(dict(code="ROW_WIDTH", message=f"{location}: expected {len(fields)} columns, found {len(cells)}. Keep an empty cell for missing values; quote CSV values containing commas.", row=row, table=table.get("table")))
                continue
            contact, extras = {}, []
            for (label, field), value in zip(fields, cells):
                value = value.strip()
                if not value:
                    continue
                if field:
                    contact[field] = [value]
                else:
                    extras.append(f"{label}: {value}")
                    if label not in extra_columns:
                        extra_columns.append(label)
            if not contact and not extras:
                continue
            notes = contact.get("notes", []) + extras
            if notes:
                contact["notes"] = ["\n".join(notes)]
            if "name" not in contact:
                contact["name"] = [next((contact[field][0] for field in SCHEMA["nameFallback"] if contact.get(field)), SCHEMA["unnamedContact"])]
                generated += 1
            if contact.get("website") and re.search(r"[\r\n]", contact["website"][0]):
                column = next(i + 1 for i, (_, field) in enumerate(fields) if field == "website")
                issues.append(dict(code="INVALID_WEBSITE", message=f"{location}: Website values must stay on one line.", row=row, column=column, table=table.get("table")))
            else:
                contacts.append(contact)
    if issues:
        raise ConversionError(issues)
    if not contacts:
        fail("NO_CONTACTS", "Your file has headers but no contacts. Add a contact below the first row.")
    return contacts, conversion_warnings(generated, extra_columns)


def table_contacts(rows, location="Line"):
    """Compatibility wrapper; all tables use the same validated conversion path."""
    header_line, header = next(rows, (1, []))
    return convert_tables([dict(header=header, header_line=header_line, rows=list(rows))])


def detect_delimiter(first, delimiter):
    visible, quoted, index = "", False, 0
    while index < len(first):
        char = first[index]
        if char == '"':
            if quoted and index + 1 < len(first) and first[index + 1] == '"':
                index += 1
            else:
                quoted = not quoted
        elif not quoted:
            visible += char
        index += 1
    if "|" in visible and (visible.strip().startswith("|") or sum(normalize_header(part) in ALIASES for part in visible.split("|")) >= 2):
        fail("UNSUPPORTED_LAYOUT", "Markdown and pipe-separated tables are not supported. Export as comma-separated CSV or tab-separated TXT/TSV.")
    if "," not in visible and "\t" not in visible and ";" in visible:
        fail("UNSUPPORTED_LAYOUT", "This looks like a semicolon-separated file. Export as comma-separated CSV or tab-separated TXT/TSV.")
    if delimiter != "auto":
        return delimiter
    if "\t" in visible:
        return "tab"
    if "," in visible:
        return "comma"
    if normalize_header(first) in ALIASES:
        return "comma"
    return "spaces" if re.search(r" {2,}", visible.strip()) else "comma"


def delimited_rows(text, delimiter):
    """Strict quote grammar shared with the browser, including physical row locations."""
    rows, cells, cell = [], [], []
    quoted = closed = False
    line = start = 1
    index = 0
    def add_row(values, number):
        if any(value.strip() for value in values):
            rows.append((number, values))
    while index < len(text):
        char = text[index]
        if quoted:
            if char == '"':
                if index + 1 < len(text) and text[index + 1] == '"':
                    cell.append('"')
                    index += 1
                else:
                    quoted, closed = False, True
            else:
                cell.append(char)
                if char == "\n":
                    line += 1
        elif char == delimiter or char == "\n":
            cells.append("".join(cell))
            cell, closed = [], False
            if char == "\n":
                add_row(cells, start)
                cells = []
                line += 1
                start = line
        elif char == '"' and not cell and not closed:
            quoted = True
        else:
            if closed or char == '"':
                fail("MALFORMED_QUOTES", f"Line {line}, column {len(cells) + 1}: check the quotes around this value.", row=line, column=len(cells) + 1)
            cell.append(char)
        index += 1
    if quoted:
        fail("MALFORMED_QUOTES", f"Line {start}, column {len(cells) + 1}: a quoted value is missing its closing quote.", row=start, column=len(cells) + 1)
    cells.append("".join(cell))
    add_row(cells, start)
    return rows


def parse_table(text, delimiter="auto"):
    text = normalize_input(text)
    first = next(line for line in text.split("\n") if line.strip())
    delimiter = detect_delimiter(first, delimiter)
    if delimiter == "spaces":
        rows = [(number, re.split(r" {2,}", line.strip())) for number, line in enumerate(text.split("\n"), 1) if line.strip()]
    else:
        rows = delimited_rows(text, "\t" if delimiter == "tab" else ",")
    return table_contacts(iter(rows))


class ContactHTMLParser(HTMLParser):
    """Read table data only; never execute markup or fetch linked resources."""

    IGNORED = {"script", "style", "template", "noscript", "iframe", "object", "svg"}
    BLOCKS = {"p", "div", "li"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.stack = []
        self.ignored = None
        self.ignore_depth = 0

    def finish_cell(self):
        if self.stack and self.stack[-1]["cell"] is not None:
            table = self.stack[-1]
            table["row"].append(table["cell"])
            table["cell"] = None

    def finish_row(self):
        self.finish_cell()
        if self.stack and self.stack[-1]["row"] is not None:
            table = self.stack[-1]
            table["rows"].append(table["row"])
            table["row"] = None

    def handle_starttag(self, tag, attrs):
        if self.ignored:
            if tag == self.ignored:
                self.ignore_depth += 1
            return
        if tag in self.IGNORED:
            self.ignored, self.ignore_depth = tag, 1
            return
        if tag == "table":
            if self.stack:
                self.stack[-1]["nested"] = True
            table = {"rows": [], "row": None, "cell": None, "nested": False}
            self.tables.append(table)
            self.stack.append(table)
            return
        if not self.stack:
            return
        table = self.stack[-1]
        if tag == "tr":
            self.finish_row()
            table["row"] = []
        elif tag in {"td", "th"}:
            self.finish_cell()
            if table["row"] is None:
                table["row"] = []
            attributes = dict(attrs)
            merged = any(key in attributes and (attributes[key] or "").strip() != "1"
                         for key in ["rowspan", "colspan"])
            table["cell"] = {"text": [], "links": [], "merged": merged}
        elif table["cell"] is not None:
            if tag == "br" or tag in self.BLOCKS:
                table["cell"]["text"].append("\n")
            elif tag == "a":
                table["cell"]["links"].append((dict(attrs).get("href") or "").strip())

    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored:
                self.ignore_depth -= 1
                if not self.ignore_depth:
                    self.ignored = None
            return
        if not self.stack:
            return
        if tag == "table":
            self.finish_row()
            self.stack.pop()
        elif tag == "tr":
            self.finish_row()
        elif tag in {"td", "th"}:
            self.finish_cell()
        elif tag in self.BLOCKS and self.stack[-1]["cell"] is not None:
            self.stack[-1]["cell"]["text"].append("\n")

    def handle_data(self, data):
        if not self.ignored and self.stack and self.stack[-1]["cell"] is not None:
            self.stack[-1]["cell"]["text"].append(re.sub(r"\s+", " ", data))

    def close(self):
        super().close()
        while self.stack:
            self.finish_row()
            self.stack.pop()


def html_cell_value(cell, field=None):
    scheme = "mailto:" if field == "email" else "tel:" if field == "phone" else None
    links = [link for link in cell["links"] if
             (link.lower().startswith(scheme) if scheme else
              field == "website" and re.match(r"^https?://", link, re.I))]
    if len(links) > 1:
        fail("MULTIPLE_LINKS", "Use one email, phone number, or website per HTML cell.")
    if links:
        if not scheme:
            return links[0]
        value = links[0][len(scheme):].split("?", 1)[0]
        if re.search(r"%(?![0-9a-fA-F]{2})", value):
            fail("INVALID_LINK", "An HTML contact link contains invalid percent encoding.")
        try:
            return unquote(value, errors="strict")
        except UnicodeDecodeError:
            fail("INVALID_LINK", "An HTML contact link contains invalid percent encoding.")
    value = re.sub(r" *\n *", "\n", "".join(cell["text"]))
    return re.sub(r"\n+", "\n", value).strip()


def parse_html(text):
    parser = ContactHTMLParser()
    parser.feed(normalize_input(text))
    parser.close()
    tables, issues = [], []
    for index, table in enumerate(parser.tables, 1):
        rows = [(number, row) for number, row in enumerate(table["rows"], 1) if any(html_cell_value(cell) or cell["links"] for cell in row)]
        if not rows:
            continue
        header_line, header_cells = rows[0]
        header = [html_cell_value(cell) for cell in header_cells]
        if not any(normalize_header(cell) in ALIASES for cell in header):
            continue
        fields = fields_for(header, header_line, index)
        if table["nested"]:
            fail("NESTED_TABLE", f"HTML table {index}: nested contact tables are not supported.", table=index)
        contacts = []
        for number, cells in rows:
            if any(cell["merged"] for cell in cells):
                issues.append(dict(code="MERGED_CELLS", message=f"HTML table {index}, row {number}: merged cells are not supported. Use one cell per column.", row=number, table=index))
            if number == header_line:
                continue
            values = []
            for column, cell in enumerate(cells):
                try:
                    values.append(html_cell_value(cell, fields[column][1] if column < len(fields) else None))
                except ConversionError as error:
                    issues.extend(dict(issue, row=number, table=index, column=column + 1,
                                       message=f"HTML table {index}, row {number}, column {column + 1}: {issue['message']}") for issue in error.issues)
                    values.append("")
            contacts.append((number, values))
        tables.append(dict(header=header, header_line=header_line, rows=contacts, table=index))
    if issues:
        raise ConversionError(issues)
    if not tables:
        fail("NO_CONTACT_TABLE", "No contact table found. Use a table with a header row containing at least one supported field: Name, Company, Address, Email, Phone, Role, Website, or Notes.")
    return convert_tables(tables)


def parse_contacts(text):
    """Each Name starts a new record. Blank lines inside a record are allowed."""
    contacts, warnings = [], []
    current = {}
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or re.fullmatch(r"[-_=]{3,}", line):
            continue
        match = LABEL.match(line)
        field = ALIASES.get(normalize_header(match[1])) if match else None
        if field is None:
            warnings.append(f"Line {number}: unrecognized line (expected Label: value).")
            continue
        value = match[2].strip()
        if field == "name":
            if not value:
                raise ValueError(f"Line {number}: Name must not be empty.")
            if current:
                contacts.append(current)
            current = {"name": [value]}
        else:
            if not current:
                raise ValueError(f"Line {number}: each contact must begin with Name:.")
            if value:
                current.setdefault(field, []).append(value)
    if current:
        contacts.append(current)
    if not contacts:
        raise ValueError("No contacts found. Use labeled lines beginning with Name:.")
    return contacts, warnings


def escape(value):
    return (value.replace("\\", "\\\\").replace("\r\n", "\n")
            .replace("\r", "\n").replace("\n", "\\n")
            .replace(";", "\\;").replace(",", "\\,"))


def fold(line):
    """Fold at 75 UTF-8 bytes without splitting a Unicode character."""
    lines, chunk, size = [], "", 0
    for character in line:
        length = len(character.encode("utf-8"))
        if size + length > 75:
            lines.append(chunk)
            chunk, size = " ", 1
        chunk += character
        size += length
    lines.append(chunk)
    return "\r\n".join(lines)


def validate_list_name(value):
    if re.search(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", value):
        fail("INVALID_LIST_NAME", "Use one line for the list name, without control characters.")
    name = re.sub(r"^[\s\ufeff]+|[\s\ufeff]+$", "", value)
    if len(name) > EXPORT_SCHEMA["maxListNameLength"]:
        fail("INVALID_LIST_NAME", f"Use {EXPORT_SCHEMA['maxListNameLength']} characters or fewer for the list name.")
    if ":::" in name:
        fail("INVALID_LIST_NAME", "Choose one list name without :::, which Google uses to separate labels.")
    return name


def make_google_csv(contacts, list_name=""):
    list_name = validate_list_name(list_name)
    if len(contacts) > EXPORT_SCHEMA["googleBatchSize"]:
        fail("GOOGLE_CONTACT_LIMIT", "Google accepts up to 3,000 contacts per import. Split the input or use the browser converter to download CSV parts.")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow([column["header"] for column in EXPORT_SCHEMA["googleColumns"]])
    for contact in contacts:
        if any(len(values) > 1 for field, values in contact.items() if field != "notes"):
            fail("GOOGLE_MULTIPLE_VALUES", "Google CSV export accepts one value per field. Use vCard to preserve repeated RTF fields.")
        values = {field: "\n".join(items) for field, items in contact.items()}
        values["name"] = next((values[field] for field in SCHEMA["nameFallback"] if values.get(field)), SCHEMA["unnamedContact"])
        values["listName"] = list_name
        website = values.get("website", "")
        if "\n" in website or "\r" in website:
            raise ValueError("Website values must stay on one line.")
        if website and not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", website):
            values["website"] = "https://" + website
        writer.writerow([column.get("label", values.get(column["field"], "")) if values.get(column["field"]) else "" for column in EXPORT_SCHEMA["googleColumns"]])
    return output.getvalue()


def make_vcards(contacts, list_name=""):
    list_name = validate_list_name(list_name)
    lines = []
    for contact in contacts:
        name = escape(next((contact[field][0] for field in SCHEMA["nameFallback"] if contact.get(field)), SCHEMA["unnamedContact"]))
        # Keep the full name intact instead of guessing cultural name order.
        lines.extend(["BEGIN:VCARD", "VERSION:3.0", f"FN:{name}", f"N:;{name};;;"])
        for company in contact.get("company", []):
            lines.append(f"ORG:{escape(company)}")
        for address in contact.get("address", []):
            # Preserve the supplied address without guessing city/postcode boundaries.
            lines.append(f"ADR;TYPE=WORK:;;{escape(address)};;;;")
        for role in contact.get("role", []):
            lines.extend([f"TITLE:{escape(role)}", f"ROLE:{escape(role)}"])
        for website in contact.get("website", []):
            if "\r" in website or "\n" in website:
                raise ValueError("Website values must stay on one line.")
            if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", website):
                website = "https://" + website
            lines.append(f"URL:{website}")
        for email in contact.get("email", []):
            lines.append(f"EMAIL;TYPE=INTERNET:{escape(email)}")
        for phone in contact.get("phone", []):
            lines.append(f"TEL:{escape(phone)}")
        if list_name:
            lines.append(f"CATEGORIES:{escape(list_name)}")
        notes = list(contact.get("notes", []))
        if list_name:
            notes.append(f"Contact list: {list_name}")
        if notes:
            lines.append(f"NOTE:{escape(chr(10).join(notes))}")
        lines.append("END:VCARD")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .txt, .csv, .tsv, .html, .htm, or .rtf file")
    parser.add_argument("-o", "--output", type=Path, help="Output file (default: input.vcf or input-google.csv)")
    parser.add_argument("--list-name", default="", help="Optional list name: vCard category/note or Google CSV label")
    parser.add_argument("--output-format", choices=["vcard", "google-csv"], default="vcard", help="Export format (default: vcard)")
    parser.add_argument("--encoding", help="Input encoding (default: UTF-8 for text, cp1252 for RTF)")
    parser.add_argument("--delimiter", choices=["auto", "tab", "comma", "spaces"], default="auto",
                        help="TXT column separator (default: detect from header)")
    parser.add_argument("--force", action="store_true", help="Replace an existing output file")
    parser.add_argument("--strict", action="store_true", help="Stop if any line is unrecognized")
    args = parser.parse_args()
    output = args.output or (args.input.with_name(args.input.stem + "-google.csv") if args.output_format == "google-csv" else args.input.with_suffix(".vcf"))
    try:
        if args.input.resolve() == output.resolve():
            raise ValueError("Input and output must be different files.")
        if args.input.suffix.lower() not in {".rtf", ".txt", ".csv", ".tsv", ".html", ".htm"}:
            fail("UNSUPPORTED_FORMAT", "Choose a .txt, .csv, .tsv, .html, .htm, or .rtf contact file.")
        data = args.input.read_bytes()
        if args.input.suffix.lower() == ".rtf":
            try:
                from striprtf.striprtf import rtf_to_text
            except ImportError:
                parser.exit(1, "For RTF input, install: python3 -m pip install striprtf\n")
            codepage = re.search(rb"\\ansicpg(\d+)", data)
            encoding = "cp" + codepage[1].decode("ascii") if codepage else (args.encoding or "cp1252")
            raw = data.decode(encoding).lstrip("\ufeff \r\n\t")
            if not raw.startswith("{\\rtf"):
                raise ValueError("Input is not an RTF document.")
            contacts, warnings = parse_contacts(rtf_to_text(raw, encoding=encoding))
        elif args.input.suffix.lower() in {".html", ".htm"}:
            contacts, warnings = parse_html(data.decode(args.encoding or "utf-8-sig"))
        else:
            delimiter = args.delimiter
            if delimiter == "auto":
                delimiter = {".csv": "comma", ".tsv": "tab"}.get(args.input.suffix.lower(), "auto")
            contacts, warnings = parse_table(data.decode(args.encoding or "utf-8-sig"), delimiter)
        for warning in warnings:
            print(f"Warning: {warning['message'] if isinstance(warning, dict) else warning}", file=sys.stderr)
        if any(isinstance(warning, str) for warning in warnings) and args.strict:
            raise ValueError("Unrecognized lines found; no output written.")
        result = make_google_csv(contacts, args.list_name) if args.output_format == "google-csv" else make_vcards(contacts, args.list_name)
        with output.open("w" if args.force else "x", encoding="utf-8", newline="") as handle:
            handle.write(result)
    except UnicodeDecodeError:
        parser.exit(1, "Error [INVALID_ENCODING]: Save your file as UTF-8 text, or specify its encoding with --encoding.\n")
    except FileExistsError:
        parser.exit(1, f"Output exists: {output}. Choose another path or use --force.\n")
    except (OSError, ValueError, LookupError, csv.Error) as error:
        parser.exit(1, f"Error [{error.code}]: {error}\n" if isinstance(error, ConversionError) else f"Error: {error}\n")
    print(f"Converted {len(contacts)} contact(s) to {output}")


if __name__ == "__main__":
    main()
