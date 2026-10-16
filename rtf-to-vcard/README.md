# TXT and RTF to vCard

Python 3.9+ command-line app. Reads local TXT columns or a labeled RTF document and writes all contacts
to one UTF-8 vCard 3.0 file. `.vcf` is the usual vCard extension; an explicit
output ending in `.vcard` also works. Conversion runs locally.

## Use online

Open [SplitIn’s TXT-to-vCard converter](https://www.splitin.net/dev-tools/txt-to-vcard),
also available under [Engineering → Dev tools](https://www.splitin.net/engineering#dev-tools).
Add a TXT, CSV, or TSV file to convert it directly in your browser, watch the
completion percentage, and download a `.vcf` file. Contact contents stay on your
device. The hosted tool accepts UTF-8 files up to 5 MB and 20,000 contacts.
For RTF files, use the Python CLI below.

## Run

TXT conversion needs only Python, with no additional packages. From the
repository root:

```sh
python3 rtf-to-vcard/rtf_to_vcard.py contacts.txt -o contacts.vcf
```

The first nonblank line must contain column headers, followed by one contact per
row. Header names are case-insensitive and columns can be reordered. Example CSV
content (also accepted in a `.txt` file):

```csv
Name,Company,address,email,contact,role
Jane Doe,Example Inc.,"123 Main St, Boston, MA",jane@example.com,+1 202-555-0100,Manager
```

Tabs, commas, or two or more spaces between columns are detected from the header.
Use `--delimiter tab`, `--delimiter comma`, or `--delimiter spaces` to override.
For CSV, quote any value containing commas. Use tabs or CSV for empty cells;
space-separated columns cannot reliably represent missing values. Single spaces
are preserved inside names, companies, addresses, and phone numbers.
Each cell contains one value. Malformed rows stop conversion before output is
written. Only Name is required; the other columns may be omitted or empty.

Address is stored whole in the work address street component. Role is saved as
both vCard TITLE and ROLE for contact-app compatibility. Text defaults to UTF-8;
use `--encoding cp1252` or `--encoding utf-16` for files saved in those encodings.

### Optional RTF support

From this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python rtf_to_vcard.py example.rtf -o contacts.vcf
python rtf_to_vcard.py "/path/to/your contacts.rtf" --strict
```

On Windows, activate with `.venv\Scripts\activate` instead.

## Expected RTF document layout

The visible text in your RTF document must use labeled lines:

```text
Name: Jane Doe
Company: Example Inc.
Website: https://example.com
Email: jane@example.com
Contact: +1 202-555-0100

Name: John Smith
Company: Sample Studio
Email: john@sample.example
Contact: +44 20 7946 0958
```

Each `Name:` starts a contact. Other fields are optional. Labels are
case-insensitive; `Phone`, `Mobile`, `Telephone`, `Organization`, and `URL`
are also accepted. Repeat an Email, Contact, or Website line for multiple
values; put one value on each line. Tabs can separate labels and values.
Names are preserved whole rather than split into guessed first/last names.
Phone numbers keep their original formatting. Websites without a scheme
receive `https://`.

Unrecognized lines generate warnings; `--strict` stops without writing output
if any are found. RTF tables and unlabeled contact blocks are not supported;
use TXT input for tabular data. Email addresses and phone numbers are copied as entered,
not validated. No contacts are deduplicated.

Output defaults to the input filename with `.vcf`. Existing output files are
protected; use `--force` to replace one. `--encoding` changes the fallback
encoding for documents without an explicit RTF codepage.

RTF decoding uses [striprtf](https://pypi.org/project/striprtf/).
