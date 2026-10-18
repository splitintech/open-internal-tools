import csv
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from fixture_runner import run
from rtf_to_vcard import ConversionError, make_google_csv, make_vcards, parse_table, validate_list_name


class ContactExportTests(unittest.TestCase):
    def test_shared_export_fixtures(self):
        fixtures = json.loads(Path(__file__).with_name('export-fixtures.json').read_text(encoding='utf-8'))
        for fixture in fixtures['cases']:
            with self.subTest(case=fixture['id']):
                result = run(dict(fixture, exportGoogle=True))
                if fixture.get('error'):
                    self.assertEqual(result['error'], fixture['error'])
                    continue
                name = validate_list_name(fixture['listName'])
                rows = list(csv.DictReader(io.StringIO(result['googleCsv'])))
                self.assertEqual(len(rows), fixture['count'])
                self.assertTrue(all(row['Labels'] == name for row in rows))
                self.assertEqual(result['content'].count('BEGIN:VCARD'), fixture['count'])
                self.assertEqual('CATEGORIES:' in result['content'], bool(name))
                self.assertTrue(all(len(line.encode('utf-8')) <= 75 for line in result['content'].split('\r\n')))

    def test_notes_and_source_are_preserved(self):
        contacts, _ = parse_table('Name,Phone,Notes\nAlex,001234,Original')
        before = json.dumps(contacts)
        card = make_vcards(contacts, 'Managers')
        self.assertIn('NOTE:Original\\nContact list: Managers\r\n', card)
        row = next(csv.DictReader(io.StringIO(make_google_csv(contacts, 'Managers'))))
        self.assertEqual(row['Phone 1 - Value'], '001234')
        self.assertEqual(row['Notes'], 'Original')
        self.assertEqual(json.dumps(contacts), before)
        self.assertNotIn('CATEGORIES:', make_vcards(contacts))

    def test_google_limit_and_repeated_rtf_fields_fail_without_loss(self):
        with self.assertRaises(ConversionError) as error:
            make_google_csv([{'name': ['Alex']}] * 3001, 'Team')
        self.assertEqual(error.exception.code, 'GOOGLE_CONTACT_LIMIT')
        with self.assertRaises(ConversionError) as error:
            make_google_csv([{'name': ['Alex'], 'phone': ['00123', '00456']}])
        self.assertEqual(error.exception.code, 'GOOGLE_MULTIPLE_VALUES')
        self.assertEqual(make_vcards([{'name': ['Alex'], 'phone': ['00123', '00456']}], 'Team').count('TEL:'), 2)

    def test_cli_named_exports_and_output_protection(self):
        script = str(Path(__file__).with_name('rtf_to_vcard.py'))
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder, 'contacts.csv')
            source.write_text('Name,Phone\nAlex,001234')
            command = [sys.executable, script, str(source), '--list-name', 'Managers']
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(b'CATEGORIES:Managers\r\n', source.with_suffix('.vcf').read_bytes())
            result = subprocess.run(command + ['--output-format', 'google-csv'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = Path(folder, 'contacts-google.csv')
            self.assertEqual(next(csv.DictReader(io.StringIO(output.read_text())))['Labels'], 'Managers')
            before = output.read_bytes()
            result = subprocess.run(command + ['--output-format', 'google-csv'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            result = subprocess.run(command + ['--output-format', 'google-csv', '--force', '--list-name', 'Bad\nName'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(source.read_text(), 'Name,Phone\nAlex,001234')


if __name__ == '__main__':
    unittest.main()
