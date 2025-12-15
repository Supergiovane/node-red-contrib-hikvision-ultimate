/* Simple unit test for ANPR picName parsing.
 * Run with:
 *   node tools/test-anpr-picname.js
 */

const assert = require("assert");
const { XMLParser } = require("fast-xml-parser");

// Sample XMLs from Hikvision ANPR camera
const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
<Plates version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <Plate>
    <captureTime>20200424T1616270000</captureTime>
    <plateNumber>DK18HVX</plateNumber>
    <picName>202004241616278800</picName>
    <country>GBR</country>
    <laneNo>1</laneNo>
    <direction>forward</direction>
  </Plate>
</Plates>`;

const xml2 = `<?xml version="1.0" encoding="UTF-8"?>
<Plates version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <Plate>
    <captureTime>20200424T1616270000</captureTime>
    <plateNumber>DK18HVX</plateNumber>
    <picName>2020042416162789540087321</picName>
    <country>GBR</country>
    <laneNo>1</laneNo>
    <direction>forward</direction>
  </Plate>
</Plates>`;

function runTest(xml, label, expectedPicName) {
    console.log("=== ANPR picName parsing test:", label, "===");

    // Parser configuration used in ANPR-config.js
    const parser = new XMLParser({ parseTagValue: false });
    const result = parser.parse(xml);

    console.log("Parsed object:\n", JSON.stringify(result, null, 2));

    assert.ok(result.Plates && result.Plates.Plate, "Parsed result does not contain Plates.Plate");

    const plate = result.Plates.Plate;
    console.log("\nPlate.picName value:   ", plate.picName);
    console.log("Plate.picName typeof:  ", typeof plate.picName);

    // picName must stay as the exact expected string
    assert.strictEqual(typeof plate.picName, "string", "picName is not a string");
    assert.strictEqual(plate.picName, expectedPicName, "picName string value changed");

    // And BigInt conversion must round-trip without changing the value
    const n = BigInt(plate.picName);
    const bigIntString = n.toString();
    console.log("BigInt(picName).toString():", bigIntString);
    assert.strictEqual(bigIntString, expectedPicName, "BigInt(picName).toString() does not match original picName");
}

try {
    runTest(xml1, "XML 1 (picName 202004241616278800)", "202004241616278800");
    console.log("\n");
    runTest(xml2, "XML 2 (long picName)", "2020042416162789540087321");
    console.log("\nAll ANPR picName tests PASSED.");
    process.exit(0);
} catch (error) {
    console.error("\nANPR picName test FAILED:", error.message || error);
    process.exit(1);
}
