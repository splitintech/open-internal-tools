"""Regression checks for contact parsing and CLI format selection."""

import json
import itertools
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from rtf_to_vcard import make_vcards, parse_contacts, parse_html, parse_table, ConversionError, SCHEMA
from fixture_runner import run


def table(headers, rows):
    return ("<table><tr>" + "".join(f"<th>{value}</th>" for value in headers) + "</tr>" +
            "".join("<tr>" + "".join(f"<td>{value}</td>" for value in row) + "</tr>" for row in rows) + "</table>")


class ContactConversionTests(unittest.TestCase):
    def test_csv_preserves_quoted_values_and_optional_cells(self):
        contacts, _ = parse_table('Name,Company,address,email,contact,role\n'
                                  '"José, 李",,"12 Main St\nBoston, MA",jose@example.com,001234,Lead\n'
                                  'Jane,Example Inc.,,,,', "comma")
        result = make_vcards(contacts)
        self.assertEqual(len(contacts), 2)
        for value in ['FN:José\\, 李', 'TEL:001234', 'ADR;TYPE=WORK:;;12 Main St\\nBoston\\, MA;;;;', 'TITLE:Lead']:
            self.assertIn(value + '\r\n', result)
        self.assertEqual(result.count('BEGIN:VCARD\r\n'), 2)

    def test_html_entities_links_and_multiple_tables(self):
        html = table(['Menu'], [['Ignore me']]) + table(
            ['EMAIL', 'Full Name', 'contact', 'address', 'Company', 'Role', 'Website'],
            [['<a href="mailto:jose%2Bteam@example.com?subject=Hi">Email</a>', '<b>José 李 &amp; Jane</b>',
              '<a href="tel:001234">Call</a>', '12 Main St<br>Boston, MA', 'A &amp; B', 'Team&nbsp;Lead',
              '<a href="https://example.com?a=1&amp;b=2">Visit</a>']]) + table(['Name'], [['Another person']])
        contacts, _ = parse_html(html)
        result = make_vcards(contacts)
        self.assertEqual(len(contacts), 2)
        for value in ['FN:José 李 & Jane', 'EMAIL;TYPE=INTERNET:jose+team@example.com', 'TEL:001234',
                      'ADR;TYPE=WORK:;;12 Main St\\nBoston\\, MA;;;;', 'ORG:A & B', 'TITLE:Team Lead',
                      'URL:https://example.com?a=1&b=2']:
            self.assertIn(value + '\r\n', result)
        self.assertNotIn('Ignore me', result)

    def test_html_ignores_scripts_templates_and_styles(self):
        html = '<script>bad()</script><template>' + table(['Name'], [['Hidden']]) + '</template>'
        html += table(['Name'], [['Jane<style>bad{}</style><script>bad()</script><img src="https://example.invalid/probe">']])
        contacts, _ = parse_html(html)
        self.assertEqual(contacts, [{'name': ['Jane']}])

    def test_html_optional_closing_tags_and_layout_table(self):
        contacts, _ = parse_html('<table><tr><td><table><tr><th>Name<th>address<tr><td>Jane<td>Street<br>City</table></table>')
        self.assertEqual(contacts, [{'name': ['Jane'], 'address': ['Street\nCity']}])

    def test_html_rejects_ambiguous_or_invalid_rows(self):
        invalid = [
            '<p>Name: Jane</p>', table(['Name'], []),
            table(['Name', 'Full Name'], [['Jane', 'John']]),
            table(['Name', 'email'], [['Jane']]),
            '<table><tr><th>Name<th>Company<tr><td colspan="2">Jane</table>',
            '<table><tr><th>Name<tr><td rowspan="0">Jane</table>',
            table(['Name'], [[table(['Name'], [['Jane']])]]),
            table(['Name', 'email'], [['Jane', '<a href="mailto:a@x.com">A</a><a href="mailto:b@x.com">B</a>']]),
            table(['Name', 'email'], [['Jane', '<a href="mailto:bad%GG@x.com">Email</a>']]),
        ]
        for html in invalid:
            with self.subTest(html=html), self.assertRaises(ValueError):
                parse_html(html)

    def test_website_cannot_inject_vcard_properties(self):
        with self.assertRaisesRegex(ValueError, 'one line'):
            parse_html(table(['Name', 'Website'], [['Jane', '<a href="https://example.com&#10;X-BAD:yes">Visit</a>']]))

    def test_labeled_rtf_text_is_still_supported(self):
        contacts, warnings = parse_contacts('Name: Jane\nCompany: Example Inc.\nContact: 001234\n\nName: John\n')
        self.assertEqual(len(contacts), 2)
        self.assertEqual(warnings, [])
        self.assertIn('TEL:001234\r\n', make_vcards(contacts))

    def test_cli_csv_and_html_extensions_and_no_partial_output(self):
        script = str(Path(__file__).with_name('rtf_to_vcard.py'))
        with tempfile.TemporaryDirectory() as directory:
            for filename, content in [('contacts.CSV', 'Name\n"Doe, Jane"\n"John ""JJ"" Smith"'),
                                      ('contacts.HTM', table(['Name'], [['Jane'], ['John']]))]:
                source = Path(directory, filename)
                source.write_text(content, encoding='utf-8')
                output = Path(directory, filename + '.vcf')
                result = subprocess.run([sys.executable, script, str(source), '-o', str(output)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output.read_bytes().count(b'BEGIN:VCARD\r\n'), 2)
                if source.suffix == '.CSV':
                    self.assertIn(b'FN:Doe\\, Jane\r\n', output.read_bytes())
                    self.assertIn(b'FN:John "JJ" Smith\r\n', output.read_bytes())
                repeated = subprocess.run([sys.executable, script, str(source), '-o', str(output)], capture_output=True, text=True)
                self.assertNotEqual(repeated.returncode, 0)
            invalid = Path(directory, 'invalid.html')
            invalid.write_text(table(['Name', 'email'], [['Jane', 'a@x.com'], ['John']]))
            result = subprocess.run([sys.executable, script, str(invalid)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(invalid.with_suffix('.vcf').exists())


class SharedContractTests(unittest.TestCase):
    def test_shared_fixtures(self):
        fixtures = json.loads(Path(__file__).with_name('fixtures.json').read_text(encoding='utf-8'))
        self.assertEqual(fixtures['version'], SCHEMA['version'])
        for case in fixtures['cases']:
            with self.subTest(case=case['id']):
                result = run(case)
                if 'error' in case:
                    self.assertEqual(result.get('error'), case['error'])
                    for key in ['row', 'column', 'table']:
                        if key in case:
                            self.assertEqual(result['issues'][0].get(key), case[key])
                else:
                    self.assertNotIn('error', result)
                    self.assertEqual(result['count'], case['count'])
                    unfolded = result['content'].replace('\r\n ', '')
                    for prop in case['contains']:
                        self.assertIn(prop + '\r\n', unfolded)
                    self.assertEqual([warning['code'] for warning in result['warnings']], case['warningCodes'])
                    self.assertEqual(result['content'].count('BEGIN:VCARD\r\n'), case['count'])
                    self.assertTrue(all(len(line.encode('utf-8')) <= 75 for line in result['content'].split('\r\n')))

    def test_every_nonempty_subset_of_fields(self):
        fields = {'Name': 'Alex', 'Company': 'Example', 'Address': 'Street', 'Email': 'a@example.com', 'Phone': '001234', 'Role': 'Lead', 'Website': 'example.com', 'Notes': 'Hello'}
        for length in range(1, len(fields) + 1):
            for keys in itertools.combinations(fields, length):
                with self.subTest(keys=keys):
                    contacts, _ = parse_table(','.join(keys) + '\n' + ','.join(fields[key] for key in keys))
                    expected = next((fields[key] for key in ['Name', 'Company', 'Email', 'Phone', 'Website'] if key in keys), 'Unnamed contact')
                    self.assertEqual(contacts[0]['name'], [expected])

    def test_collects_row_errors_with_physical_line_numbers(self):
        with self.assertRaises(ConversionError) as caught:
            parse_table('Name,Notes\nAlex,"One\nTwo"\nBad\nAlso,bad,extra')
        self.assertEqual([issue['row'] for issue in caught.exception.issues], [4, 5])

    def test_rtf_notes_and_writer_fallback(self):
        contacts, _ = parse_contacts('Name: Alex\nNotes: Keep this\nComment: Also this\n')
        self.assertIn('NOTE:Keep this\\nAlso this\r\n', make_vcards(contacts))
        self.assertIn('FN:a@example.com\r\n', make_vcards([{'email': ['a@example.com']}]))

    def test_cli_encoding_force_strict_and_no_partial_output(self):
        script = str(Path(__file__).with_name('rtf_to_vcard.py'))
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, 'contacts.txt')
            output = Path(directory, 'contacts.vcf')
            source.write_bytes('Name,Tag\nAndré,Lead'.encode('cp1252'))
            def cli(*args):
                return subprocess.run([sys.executable, script, str(source), '-o', str(output), *args], capture_output=True, text=True)
            self.assertNotEqual(cli().returncode, 0)
            self.assertFalse(output.exists())
            self.assertEqual(cli('--encoding', 'cp1252', '--strict').returncode, 0)
            self.assertIn('André', output.read_text())
            before = output.read_bytes()
            self.assertNotEqual(cli('--encoding', 'cp1252').returncode, 0)
            source.write_text('Name,Email\nAlex,a@example.com\nBad', encoding='utf-8')
            self.assertNotEqual(cli('--force').returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            source.write_text('Name\nUpdated', encoding='utf-8')
            self.assertEqual(cli('--force').returncode, 0)
            self.assertIn('Updated', output.read_text())


if __name__ == '__main__':
    unittest.main()
