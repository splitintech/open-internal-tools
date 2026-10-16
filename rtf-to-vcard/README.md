# TXT, CSV, HTML and RTF to vCard

Python 3.9+ command-line app. Reads local TXT/CSV/TSV columns, HTML contact tables,
or a labeled RTF document and writes all contacts
to one UTF-8 vCard 3.0 file. `.vcf` is the usual vCard extension; an explicit
output ending in `.vcard` also works. Conversion runs locally.

## Use online

Open [SplitIn’s contact-to-vCard converter](https://www.splitin.net/dev-tools/txt-to-vcard),
also available under [Engineering → Dev tools](https://www.splitin.net/engineering#dev-tools).
Add a TXT, CSV, TSV, HTML, or HTM file to convert it directly in your browser, watch the
completion percentage, and download a `.vcf` file. Contact contents stay on your
device. The hosted tool accepts UTF-8 files up to 5 MB and 20,000 contacts.
For HTML, use a contact table with a header row as shown in [HTML input](#html-input).
For RTF files, use the Python CLI below.

## Bulk import into Apple or Google Contacts

Each input row becomes a separate contact record. The converter bundles those
records into **one `.vcf` file**: 100 rows produce one file containing 100 contacts,
not 100 separate files. vCard is the format; `.vcf` is its standard file extension.
Conversion only creates the file. Import it using one of the guides below to add
the contacts to your address book.

### 1. Prepare and download your contacts

1. Save your contact list as UTF-8 TXT, CSV, or TSV with a labeled header row
   and one contact per row. Columns can appear in any order and fields may be
   omitted or blank, including Name. See [Run](#run) for an example using property
   management contact headers. For HTML/HTM, see [HTML input](#html-input).
2. Open the [SplitIn converter](https://www.splitin.net/dev-tools/txt-to-vcard)
   on your phone or computer.
3. Tap or click the file upload area and select your file. On desktop, you can
   also drag the file into the upload area.
4. Wait for conversion to reach **100%**. Check the contact count and any notes
   about generated names or extra columns preserved in Notes.
5. Optionally enter a **List name** beside the download options, for example
   `Boston Property Managers`. Then choose **Download vCard** for Apple/general
   use, or **Download Google CSV** to import into a Google label. Downloads update
   when you edit the name. Leaving it blank keeps the input filename as the base
   and adds no list metadata. If you used the CLI, use its generated file instead.
6. Follow the guide for the account where you want to save the contacts. Import
   a batch only once into that account; use account syncing to see it on your
   other devices.

### Named lists and download options

- **vCard:** one combined `.vcf`. A supplied list name is saved as one escaped
  `CATEGORIES` value and appended to each contact's existing Notes as
  `Contact list: Boston Property Managers`. Original names and notes are preserved.
  Category support varies by importer. **Opening this file does not automatically
  create an Apple Contacts list.** After importing, create a list and add the
  imported contacts. In iCloud Contacts, imports initially appear in All Contacts;
  drag the desired contacts into your new list. See Apple's
  [list instructions](https://support.apple.com/guide/icloud/mmfba73c71/icloud).
- **Google CSV:** uses Google's documented headers and places the list name in
  every contact's `Labels` field. Import this file through Google Contacts on a
  computer to apply the label. The name is not added to Notes in the CSV.
  For more than 3,000 contacts, expand **Google CSV · N files**, download all parts,
  and import each once into the same Google account. Every part carries the same
  label; the browser still offers one combined VCF.
- List names allow Unicode and punctuation, up to 120 characters. Leading/trailing
  whitespace is trimmed. Line breaks, control characters and `:::` are rejected;
  Google uses `:::` to separate multiple labels. Only the filename is sanitized
  for filesystem characters; the exported list name is preserved.
- Google labels are a Google Contacts feature. Syncing the contacts to an iPhone
  does not guarantee that the label becomes an Apple list. Native Android VCF
  import also does not establish Google label creation; use the Google CSV/web
  workflow when labels matter.

This remains local file generation, with no Google sign-in, address-book writes,
or backend. Importing is a separate action. Import **one chosen format** per batch
into an account; importing both CSV and VCF can create duplicates. Names and phone
numbers are exported as text. Import the CSV directly into Google Contacts;
spreadsheet apps may reformat phone numbers if you open and resave it.

### Apple on mobile: iPhone or iPad

1. To save to iCloud, open **Settings → [your name] → iCloud → See All**
   beside **Saved to iCloud**, and enable **Contacts**.
2. If you have several contact accounts, go to
   **Settings → Apps → Contacts → Default Account** and select **iCloud**.
   Older systems may show Contacts directly in Settings.
3. Make the downloaded `.vcf` available as an email or message attachment to
   yourself, then open that email or message on the device.
4. Tap the `.vcf` attachment. In the contact preview, follow the prompts to add
   the contacts. If an **Add All Contacts** option appears, use it and choose
   to create new contacts. Button wording can vary by system version.
5. Open **Contacts → Lists → All iCloud** and check several imported names,
   phone numbers, and email addresses.

If the preview shows only one person or offers no way to add the whole batch,
use the iCloud browser method below on a computer or iPad, then let iCloud sync
the contacts to your phone. Apple supports iCloud Contacts on the web on tablets
and computers; do not rely on that web interface on an iPhone.

See Apple's [iPhone import guide](https://support.apple.com/guide/iphone/iph356499f31/ios),
[iPad import guide](https://support.apple.com/en-ie/guide/ipad/ipad3e95b18b/ipados),
and [contact account settings](https://support.apple.com/en-mt/guide/iphone/iph7edacccf9/ios).

### Apple on desktop: iCloud in a browser (Mac or Windows)

1. Open [iCloud Contacts](https://www.icloud.com/contacts/) in your browser.
2. Sign in with the Apple Account where you want the contacts saved.
3. Select the **+** (Add) button on the right, then **Import Contact**.
4. Select the downloaded `.vcf` file and wait for the import to finish.
5. Open **All Contacts** and check the imported entries. Each person in the file
   becomes a separate contact.
6. To see them on an iPhone or iPad, sign in to the same Apple Account and enable
   iCloud Contacts using step 1 of the mobile guide above.

This method also works on an iPad. See Apple's
[iCloud import guide](https://support.apple.com/guide/icloud/mmfba748b2/icloud).

### Apple on desktop: Contacts app on Mac

1. Open the Mac **Contacts** app.
2. If you want these contacts in iCloud, enable Contacts for your iCloud account.
   If several accounts are configured, choose iCloud under
   **Contacts → Settings → General → Default Account**.
3. Choose **File → Import**, select the downloaded `.vcf`, and open it.
4. Review the import dialog and click **Add**. If Contacts detects duplicates,
   review its choices before confirming.
5. Check the imported contacts in the intended account. With iCloud Contacts
   enabled on your other Apple devices, the contacts sync there as well.

See Apple's [Mac import guide](https://support.apple.com/en-gb/guide/contacts/adrbk1457/mac)
and [Mac account and sync settings](https://support.apple.com/en-euro/guide/contacts/adrb7e5aaa2a/mac).

### Google on desktop: browser (Windows, Mac, or Chromebook)

1. Open [Google Contacts](https://contacts.google.com/) in your browser.
2. Check the profile icon and switch to the Google Account that should receive
   the new contacts.
3. Select **Import** in the left sidebar, then **Select file**.
4. Choose the downloaded Google `.csv` to use your named label, or the `.vcf`
   for an ordinary contact import, and click **Import**.
5. Wait for completion and check the imported names and contact details. For CSV,
   check that the chosen label contains the imported contacts.

For large batches, keep each import to **3,000 contacts or fewer**, as documented
by Google. The browser's Google CSV option splits these batches automatically;
download and import every numbered part. For VCF imports, split a larger input
list and convert/import each batch separately. The converter's 20,000-contact
browser limit does not override Google's import limit.

See Google's [desktop import guide](https://support.google.com/contacts/answer/15147365?co=GENIE.Platform%3DDesktop&hl=en).

### Google on mobile: Android phone or tablet

1. Download the converted `.vcf` to the Android device.
2. Open the **Google Contacts** app. These steps refer to Google's app; a phone
   manufacturer's Contacts app may have different menus.
3. Tap **Organize → Import from file**.
4. If asked, select the Google Account where you want to save the contacts.
5. Find the downloaded `.vcf`, usually in Downloads, and select it.
6. Wait for the import, then check the contacts in the selected account.

Contacts saved to that Google Account sync to devices signed in to the same
account when contact syncing is enabled.

For a named Google label, use the CSV import workflow on a computer, then sync
that Google account to the phone. Downloading a CSV on the phone alone does not
import it through the native Contacts app.

See Google's [Android import guide](https://support.google.com/contacts/answer/15147365?co=GENIE.Platform%3DAndroid&hl=en)
and [Android sync guide](https://support.google.com/contacts/answer/2753077?co=GENIE.Platform%3DAndroid&hl=en).

### Google contacts on an iPhone or iPad

Use the Google desktop import guide above to add the file to your Google Account,
then display those contacts on your Apple device:

1. Open **Settings → Apps → Contacts → Contacts Accounts**.
2. Choose **Add Account → Google**, and sign in to the same Google Account used
   for the import. If it is already listed, open that account instead.
3. Enable **Contacts** for the account and finish any on-screen prompts.
4. Open **Contacts → Lists**, select the Google account's list, and allow time
   for the imported contacts to appear.

This syncs contacts already imported into Google; it is not a second file
import. Do not import the same file into iCloud unless you also want a separate
copy there.

See Apple's [contact account settings](https://support.apple.com/en-mt/guide/iphone/iph7edacccf9/ios)
and Google's [iPhone/iPad sync guide](https://support.google.com/contacts/answer/2753077?co=GENIE.Platform%3DiOS&hl=en).

The platform guides above were checked against Apple and Google documentation on
2026-10-16. Automated conversion tests are separate from actual account/device
imports; button labels can vary by OS version.

### Add another batch later

1. Create a new input file containing only the new contacts, with the same header.
2. Convert it and download the new `.vcf`.
3. Import it once into the same Apple or Google account using the relevant guide.
4. Check that the new contacts appear and allow account syncing to finish.

The converter does not compare your file with your address book, deduplicate
records, or update existing contacts. Reimporting an old batch may create
duplicates; any duplicate review or merging belongs to the destination app.
Changing a row and importing it again is not a guaranteed way to update an
existing contact.

## Run

TXT, CSV, TSV, and HTML conversion need only Python, with no additional packages. From the
converter directory (`rtf-to-vcard` in open-internal-tools, `tools/rtf-to-vcard` in SplitIn):

```sh
python3 rtf_to_vcard.py contacts.txt -o contacts.vcf
python3 rtf_to_vcard.py contacts.csv -o csv-contacts.vcf
python3 rtf_to_vcard.py contacts.html -o html-contacts.vcf
python3 rtf_to_vcard.py contacts.csv --list-name "Boston Property Managers" -o managers.vcf
python3 rtf_to_vcard.py contacts.csv --output-format google-csv --list-name "Boston Property Managers"
```

`--output-format google-csv` defaults to `contacts-google.csv`, avoiding overwriting
the input CSV. The CLI accepts up to 3,000 contacts per Google CSV; for larger lists,
split the input or use the browser's numbered exports. Repeated fields in labeled
RTF require vCard output to avoid losing values. Validation completes before any
output is opened, including with `--force`. The shared export rules and additional
regression fixtures are in [export-schema.json](export-schema.json) and
[export-fixtures.json](export-fixtures.json).

The first nonblank line must contain column headers, followed by one contact per
row. Header names are case-insensitive and columns can be reordered. Example CSV
content (also accepted in a `.txt` file):

```csv
Contact Number,Name,Property Management Company,Website,Email,Current Business Address,Notes
001234,Jane Doe,Example Inc.,https://example.com,jane@example.com,"123 Main St, Boston, MA",Call next week
```

For TXT, tabs, commas, or two or more spaces between columns are detected from the
header outside quoted values. CSV uses commas and TSV uses tabs. Single-column
TXT and CSV files support quoted names such as `"Morgan, Alex"`.
Use `--delimiter tab`, `--delimiter comma`, or `--delimiter spaces` to override.
For CSV, quote any value containing commas. Use tabs or CSV for empty cells;
space-separated columns cannot reliably represent missing values. Single spaces
are preserved inside names, companies, addresses, and phone numbers.
Each cell contains one value. Malformed rows stop conversion before output is
written. Every field, including Name, may be omitted or empty. Entirely empty
rows are skipped. Missing values still need separators: beneath `Name,Company,Email`,
use `Alex,,alex@example.com`. A shorter row is ambiguous and is rejected.
Semicolon-separated exports and Markdown/pipe tables need to be exported as
comma-separated CSV or tab-separated TXT/TSV first.

### Flexible headers and contact names

Headers are matched after Unicode normalization, case folding, whitespace
normalization, and treating hyphens/underscores as spaces. Matching uses explicit
aliases; it does not guess from substrings. The complete versioned contract is
[field-schema.json](field-schema.json).

| Field | Accepted examples | vCard property |
| --- | --- | --- |
| Name | Name, Full Name, Contact Name | FN and N |
| Company | Company, Company Name, Organization, Organisation, Property Management Company, Management Company | ORG |
| Address | Address, Business Address, Current Business Address, Mailing Address | ADR |
| Email | Email, E-mail, Email Address, E-mail Address, Email ID | EMAIL |
| Phone | Contact, Contact Number, Phone, Phone Number, Mobile, Mobile Number, Telephone, Tel | TEL |
| Role | Role, Title, Job Title | TITLE and ROLE |
| Website | Website, Web, URL, Website URL | URL |
| Notes | Notes, Note, Comments, Comment, Additional Information | NOTE |

When Name is absent or empty, the display name uses the first nonempty value in
**Company → Email → Phone → Website → “Unnamed contact”**. Address-only, role-only,
and notes-only rows are retained. Phone numbers stay text, including leading zeros.

Other labeled columns are retained in Notes as `Original header: value`, after
explicit Notes and in source-column order. For example, `Tag=Lead` becomes
`Tag: Lead`. No field is silently discarded. Duplicate header labels or aliases
for the same field (such as Phone plus Contact Number) stop conversion and identify
both columns. Blank labels must be named before conversion.

### Errors and warnings

A malformed file produces no partial export. Errors identify the physical line
(or HTML table and row), and the column where available. Independent row errors
are collected; broken quote syntax stops immediately. The browser shows the first
20 errors and the number remaining. Examples of stable error codes are
`INVALID_HEADER`, `DUPLICATE_HEADER`, `ROW_WIDTH`, `MALFORMED_QUOTES`,
`UNSUPPORTED_LAYOUT`, `INVALID_ENCODING`, `NO_CONTACTS`, and `INVALID_WEBSITE`.
The browser additionally enforces `FILE_LIMIT` and `CONTACT_LIMIT`.

Generated names and extra fields produce informational warnings, not failures.
The CLI prints them to stderr. `--strict` continues to apply to unrecognized
labeled RTF lines; it does not reject these informational conversion warnings.

Address is stored whole in the work address street component. Role is saved as
both vCard TITLE and ROLE for contact-app compatibility. Text defaults to UTF-8;
use `--encoding cp1252` or `--encoding utf-16` for files saved in those encodings.

### HTML input

Save a UTF-8 `.html` or `.htm` file containing a contact table. The first nonempty
row must contain recognized column names in `<th>` or `<td>` cells. Each later
row represents one contact. Any supported field can identify the table, including
Phone or Notes; Name is optional. Header names and aliases follow the same rules
as TXT/CSV. A table containing only unfamiliar headers is ignored; give at least
one column a supported label such as Notes.

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contacts</title></head><body>
<table>
<tr><th>Contact Number</th><th>Name</th><th>Property Management Company</th><th>Website</th><th>Email</th><th>Current Business Address</th><th>Notes</th></tr>
<tr><td>001234</td><td>Jane Doe</td><td>Example Inc.</td><td>https://example.com</td><td>jane@example.com</td><td>123 Main St, Boston, MA</td><td>Call next week</td></tr>
</table>
</body></html>
```

Try [example.csv](example.csv) or [example.html](example.html). The online converter
also offers downloadable TXT, CSV, and HTML samples.

- Contact tables can appear inside a complete HTML document or a table fragment.
  All tables with at least one supported header are combined into the same `.vcf`; unrelated
  tables are ignored. Invalid contact tables stop the whole conversion.
- Text formatting tags are removed, HTML entities such as `&amp;` are decoded,
  and `<br>`/paragraph breaks are preserved inside addresses.
- Email and phone columns use `mailto:` and `tel:` link values when present.
  A Website column can use an absolute HTTP/HTTPS link. Otherwise, the cell's
  text is used. Keep one value per cell; multiple matching links are rejected.
- Merged cells (`rowspan`/`colspan` other than 1) and nested tables inside a
  contact table are rejected. Use a simple rectangular table.
- Scripts, styles, templates, and embedded content are ignored. Conversion reads
  the uploaded file locally without running its scripts or fetching resources.
  This is not a URL scraper: arbitrary page layouts and contacts generated only
  by JavaScript are not supported. Export those contacts as CSV or an HTML table.

### Run the converter tests

From the converter directory (`rtf-to-vcard` in open-internal-tools, `tools/rtf-to-vcard` in SplitIn):

```sh
python3 -m unittest discover -s . -p 'test_*.py' -v
```

### Shared contract and regression checks

`field-schema.json` is the canonical field contract. Its case-fold table records
Unicode characters whose full fold differs from lowercase, so JavaScript can
match Python's Unicode header behavior. `fixtures.json` contains synthetic valid
and invalid examples. `fixture_runner.py` exposes the Python results as JSON for
SplitIn's cross-language tests. These files and the CLI are mirrored into SplitIn;
update the mirror with the same change and run both test suites.

The browser test suite compares decoded vCard properties, counts, warnings, and
structured errors with Python. It also covers all 255 nonempty field subsets,
20,000-contact HTML input, cancellation, and no partial exports. Text conversion
requires no extra Python packages. Independent format validation uses optional
test-only `vobject`; it is not a runtime dependency.

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
