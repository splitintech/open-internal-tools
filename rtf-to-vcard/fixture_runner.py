"""JSON bridge for cross-language regression tests; reads fixtures only from stdin."""
import json
import sys
from rtf_to_vcard import parse_table, parse_html, make_vcards, ConversionError

def run(case):
    try:
        contacts, warnings = (parse_html(case["input"]) if case["format"] in {"html", "htm"} else
                              parse_table(case["input"], {"csv": "comma", "tsv": "tab"}.get(case["format"], "auto")))
        return dict(content=make_vcards(contacts), count=len(contacts), warnings=warnings)
    except ConversionError as error:
        return dict(error=error.code, issues=error.issues)

if __name__ == "__main__":
    print(json.dumps([run(case) for case in json.load(sys.stdin)]))
