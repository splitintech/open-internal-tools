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

## Bulk import into Apple or Google Contacts

Each input row becomes a separate contact record. The converter bundles those
records into **one `.vcf` file**: 100 rows produce one file containing 100 contacts,
not 100 separate files. vCard is the format; `.vcf` is its standard file extension.
Conversion only creates the file. Import it using one of the guides below to add
the contacts to your address book.

### 1. Prepare and download your contacts

1. Save your contact list as UTF-8 TXT, CSV, or TSV with the header
   `Name,Company,address,email,contact,role` and one contact per row. Use the CSV
   example in [Run](#run) for values containing commas.
2. Open the [SplitIn converter](https://www.splitin.net/dev-tools/txt-to-vcard)
   on your phone or computer.
3. Tap or click the file upload area and select your file. On desktop, you can
   also drag the file into the upload area.
4. Wait for conversion to reach **100%** and check the displayed contact count.
5. Select **Download vCard** and save the resulting `.vcf` file. If you used the
   Python CLI, use its generated `.vcf` instead.
6. Follow the guide for the account where you want to save the contacts. Import
   a batch only once into that account; use account syncing to see it on your
   other devices.

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
4. Choose the downloaded `.vcf` and click **Import**.
5. Wait for completion and check the imported names and contact details.

For large batches, keep each import to **3,000 contacts or fewer**, as documented
by Google. Split a larger input list into smaller files, keep the header in each,
and convert/import each batch separately. The converter's 20,000-contact browser
limit does not override Google's import limit.

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
