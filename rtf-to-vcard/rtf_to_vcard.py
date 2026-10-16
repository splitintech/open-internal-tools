#!/usr/bin/env python3
"""Convert TXT contact columns or labeled RTF contacts to UTF-8 vCard 3.0."""

import argparse
import csv
import io
import re
import sys
from pathlib import Path


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
    _, header = next(rows, (0, []))
    fields = [ALIASES.get(cell.strip().lower()) for cell in header]
    if None in fields or "name" not in fields or len(set(fields)) != len(fields):
        raise ValueError("Expected unique column headers such as Name, Company, Address, Email, Contact, Role. "
                         "Use tabs, commas, or two or more spaces between columns.")
    contacts = []
    for number, row in rows:
        if len(row) != len(fields):
            raise ValueError(f"Line {number}: expected {len(fields)} columns, found {len(row)}. "
                             "Quote values containing commas in CSV; use tabs or CSV for empty columns.")
        contact = {field: [value.strip()] for field, value in zip(fields, row) if value.strip()}
        if "name" not in contact:
            raise ValueError(f"Line {number}: Name must not be empty.")
        contacts.append(contact)
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
    parser.add_argument("input", type=Path, help="Input .txt, .csv, .tsv, or .rtf file")
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
        else:
            contacts, warnings = parse_table(data.decode(args.encoding or "utf-8-sig"), args.delimiter)
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
