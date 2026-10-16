#!/usr/bin/env python3
"""Convert TXT/CSV/TSV columns, HTML tables, or labeled RTF contacts to vCard 3.0."""

import argparse
import csv
import io
import re
import sys
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote


ALIASES = {
    "name": "name", "full name": "name",
    "company": "company", "organization": "company",
    "website": "website", "web": "website", "url": "website",
    "email": "email", "e-mail": "email",
    "contact": "phone", "contact number": "phone",
    "phone": "phone", "phone number": "phone",
    "mobile": "phone", "telephone": "phone", "tel": "phone",
    "address": "address", "role": "role", "title": "role",
}
LABEL = re.compile(r"^([^:\t]+?)\s*(?::|\t)\s*(.*)$")


def table_contacts(rows, location="Line"):
    """Share column validation between text files and HTML tables."""
    _, header = next(rows, (0, []))
    fields = [ALIASES.get(cell.strip().lower()) for cell in header]
    if None in fields or "name" not in fields or len(set(fields)) != len(fields):
        raise ValueError("Expected unique column headers such as Name, Company, Address, Email, Contact, Role. "
                         "Name is required; Website is also supported.")
    contacts = []
    for number, row in rows:
        if len(row) != len(fields):
            raise ValueError(f"{location} {number}: expected {len(fields)} columns, found {len(row)}. "
                             "Keep an empty cell for missing values; quote CSV values containing commas.")
        contact = {field: [value.strip()] for field, value in zip(fields, row) if value.strip()}
        if "name" not in contact:
            raise ValueError(f"{location} {number}: Name must not be empty.")
        contacts.append(contact)
    if not contacts:
        raise ValueError("The file has a header but no contacts.")
    return contacts, []


def parse_table(text, delimiter="auto"):
    """Require a recognized header and reject rows that could shift columns."""
    text = text.lstrip("\ufeff\r\n")
    first = next((line for line in text.splitlines() if line.strip()), "")
    if not first:
        raise ValueError("The text file is empty.")
    if delimiter == "auto":
        if "\t" in first:
            delimiter = "tab"
        elif "," in first:
            delimiter = "comma"
        else:
            delimiter = "spaces"
    if delimiter == "spaces":
        rows = ((n, re.split(r" {2,}", line.strip()))
                for n, line in enumerate(text.splitlines(), 1) if line.strip())
    else:
        reader = csv.reader(io.StringIO(text), delimiter="\t" if delimiter == "tab" else ",", strict=True)
        rows = ((reader.line_num, row) for row in reader if any(cell.strip() for cell in row))
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
        raise ValueError("Use one email, phone number, or website per HTML cell.")
    if links:
        if not scheme:
            return links[0]
        value = links[0][len(scheme):].split("?", 1)[0]
        if re.search(r"%(?![0-9a-fA-F]{2})", value):
            raise ValueError("An HTML contact link contains invalid percent encoding.")
        return unquote(value, errors="strict")
    value = re.sub(r" *\n *", "\n", "".join(cell["text"]))
    return re.sub(r"\n+", "\n", value).strip()


def parse_html(text):
    parser = ContactHTMLParser()
    parser.feed(text)
    parser.close()
    contacts = []
    found_table = False
    for index, table in enumerate(parser.tables, 1):
        rows = [row for row in table["rows"] if any(html_cell_value(cell) or cell["links"] for cell in row)]
        header = [html_cell_value(cell) for cell in rows[0]] if rows else []
        fields = [ALIASES.get(cell.lower()) for cell in header]
        if "name" not in fields:
            continue
        found_table = True
        if table["nested"]:
            raise ValueError(f"HTML table {index}: nested contact tables are not supported.")
        if any(cell["merged"] for row in rows for cell in row):
            raise ValueError(f"HTML table {index}: merged cells are not supported. Use one cell per column.")
        values = [header] + [[html_cell_value(cell, fields[column] if column < len(fields) else None)
                              for column, cell in enumerate(row)] for row in rows[1:]]
        # Empty contact tables are allowed beside populated tables.
        if len(values) == 1:
            if None in fields or len(set(fields)) != len(fields):
                raise ValueError(f"HTML table {index}: use unique, recognized column headers.")
            continue
        parsed, _ = table_contacts(iter(enumerate(values, 1)), f"HTML table {index}, row")
        contacts.extend(parsed)
    if not found_table:
        raise ValueError("No contact table found. Use an HTML table with Name, Company, address, email, contact, role headers and one contact per row.")
    if not contacts:
        raise ValueError("The file has a header but no contacts.")
    return contacts, []


def parse_contacts(text):
    """Each Name starts a new record. Blank lines inside a record are allowed."""
    contacts, warnings = [], []
    current = {}
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or re.fullmatch(r"[-_=]{3,}", line):
            continue
        match = LABEL.match(line)
        field = ALIASES.get(match[1].strip().lower()) if match else None
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


def make_vcards(contacts):
    lines = []
    for contact in contacts:
        name = escape(contact["name"][0])
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
        lines.append("END:VCARD")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .txt, .csv, .tsv, .html, .htm, or .rtf file")
    parser.add_argument("-o", "--output", type=Path, help="Output file (default: input.vcf)")
    parser.add_argument("--encoding", help="Input encoding (default: UTF-8 for text, cp1252 for RTF)")
    parser.add_argument("--delimiter", choices=["auto", "tab", "comma", "spaces"], default="auto",
                        help="TXT column separator (default: detect from header)")
    parser.add_argument("--force", action="store_true", help="Replace an existing output file")
    parser.add_argument("--strict", action="store_true", help="Stop if any line is unrecognized")
    args = parser.parse_args()
    output = args.output or args.input.with_suffix(".vcf")
    try:
        if args.input.resolve() == output.resolve():
            raise ValueError("Input and output must be different files.")
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
            print(f"Warning: {warning}", file=sys.stderr)
        if warnings and args.strict:
            raise ValueError("Unrecognized lines found; no output written.")
        result = make_vcards(contacts)
        with output.open("w" if args.force else "x", encoding="utf-8", newline="") as handle:
            handle.write(result)
    except FileExistsError:
        parser.exit(1, f"Output exists: {output}. Choose another path or use --force.\n")
    except (OSError, ValueError, LookupError, csv.Error) as error:
        parser.exit(1, f"Error: {error}\n")
    print(f"Converted {len(contacts)} contact(s) to {output}")


if __name__ == "__main__":
    main()
