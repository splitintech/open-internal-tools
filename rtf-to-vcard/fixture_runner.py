"""JSON bridge for cross-language regression tests; reads fixtures only from stdin."""
import json
import sys
from rtf_to_vcard import parse_table, parse_html, make_vcards, make_google_csv, ConversionError

def run(case):
    try:
        contacts, warnings = (parse_html(case["input"]) if case["format"] in {"html", "htm"} else
                              parse_table(case["input"], {"csv": "comma", "tsv": "tab"}.get(case["format"], "auto")))
        result = dict(content=make_vcards(contacts, case.get("listName", "")), count=len(contacts), warnings=warnings)
        if case.get("exportGoogle"):
            result["googleCsv"] = make_google_csv(contacts, case.get("listName", ""))
        return result
    except ConversionError as error:
        return dict(error=error.code, issues=error.issues)

if __name__ == "__main__":
    print(json.dumps([run(case) for case in json.load(sys.stdin)]))
