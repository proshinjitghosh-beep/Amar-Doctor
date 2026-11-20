import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, makePdf, makePng } from './helpers/module-fixture.js';
import { stubFetch, jsonResponse } from './helpers/test-app.js';

const fixture = await createFixture('reports');
const skip = fixture.available ? false : 'no test database configured';

const LAB_TEXT = [
  'Patient Name: Rahim Uddin',
  'Report Type: CBC (Complete Blood Count)',
  'Test Name            Result      Unit        Reference Range',
  'Hemoglobin           11.2        g/dL        12.0 - 16.0',
  'Total WBC            7500        /uL         4000 - 11000',
  'ESR                  18          mm/hr       0 - 20',
];

async function upload(client, buffer, filename = 'report.pdf', type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  return client.post('/api/reports/upload', form);
}

test.after(async () => {
  if (fixture.available) await fixture.close();
});

test('a PDF report is stored and its lab rows are extracted', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const response = await upload(client, makePdf(LAB_TEXT));

  assert.equal(response.status, 201);
  assert.equal(response.body.report.extractionMethod, 'pdf_text');
  assert.equal(response.body.report.reportType, 'CBC');

  const hemoglobin = response.body.results.find((row) => row.testName === 'Hemoglobin');
  assert.equal(hemoglobin.resultValue, '11.2');
  assert.equal(hemoglobin.unit, 'g/dL');
  assert.equal(hemoglobin.referenceRange, '12.0 - 16.0');
  // 11.2 is below the printed range 12.0 - 16.0.
  assert.equal(hemoglobin.status, 'below_reference');

  const esr = response.body.results.find((row) => row.testName === 'ESR');
  assert.equal(esr.status, 'normal');
});

test('the report type comes from the content, not the file name', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const response = await upload(client, makePdf(LAB_TEXT), 'final-v2-copy.pdf');
  assert.equal(response.body.report.reportType, 'CBC');
});

test('a file whose bytes are not a PDF is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await upload(client, Buffer.from('this is plain text, not a pdf'), 'report.pdf');
  assert.equal(response.status, 400);
  assert.match(response.body.error, /প্রকৃত বিষয়বস্তু/);
});

test('an unsupported file type is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await upload(client, Buffer.from('id,name\n1,a\n'), 'data.csv', 'text/csv');
  assert.equal(response.status, 400);
});

test('an oversized upload is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const big = Buffer.alloc(9 * 1024 * 1024, 0x41);
  const response = await upload(client, big, 'big.pdf');
  assert.equal(response.status, 413);
  assert.match(response.body.error, /আকার/);
});

test('a PNG upload is accepted', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const response = await upload(client, makePng(), 'scan.png', 'image/png');
  // The image is stored. Without a vision model the text cannot be read, but
  // the upload itself still succeeds.
  assert.equal(response.status, 201);
  assert.equal(response.body.report.mimeType, 'image/png');
});

test('the analysis is marked unavailable when the AI cannot be reached', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const uploaded = await upload(client, makePdf(LAB_TEXT));
  const reportId = uploaded.body.report.id;

  const stub = stubFetch(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    const response = await client.post(`/api/reports/${reportId}/analyze`, { language: 'bn' });
    assert.equal(response.status, 503);
    assert.equal(response.body.report.analysisStatus, 'unavailable');
    // The extracted rows are still returned - nothing is fabricated.
    assert.ok(response.body.results.length > 0);
    assert.equal(response.body.report.analysis, null);
  } finally {
    stub.restore();
  }
});

test('the AI only explains rows that were actually read', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const uploaded = await upload(client, makePdf(LAB_TEXT));
  const reportId = uploaded.body.report.id;

  const stub = stubFetch(async () =>
    jsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              report_type: 'CBC',
              summary: 'রিপোর্টের সারাংশ',
              results: [
                { test_name: 'Hemoglobin', explanation: 'এটি প্রিন্ট করা রেঞ্জের নিচে।', requires_review: false },
                { test_name: 'Not In The Report', explanation: 'এটি বানানো তথ্য।', requires_review: false },
              ],
              important_observations: [],
              questions_for_doctor: [],
              limitations: [],
            }),
          },
        },
      ],
    })
  );
  try {
    const response = await client.post(`/api/reports/${reportId}/analyze`, { language: 'bn' });
    assert.equal(response.status, 200);
    assert.equal(response.body.report.analysisStatus, 'analyzed');

    const names = response.body.results.map((row) => row.testName);
    assert.equal(names.includes('Not In The Report'), false);
    assert.equal(names.includes('Hemoglobin'), true);

    // The AI cannot change the status that our own comparison produced.
    const hemoglobin = response.body.results.find((row) => row.testName === 'Hemoglobin');
    assert.equal(hemoglobin.status, 'below_reference');
    assert.equal(hemoglobin.explanation, 'এটি প্রিন্ট করা রেঞ্জের নিচে।');
  } finally {
    stub.restore();
  }
});

test('another patient cannot read, download or delete a report', { skip }, async () => {
  await fixture.reset();
  const owner = await fixture.registerPatient();
  const other = await fixture.registerPatient();

  const uploaded = await upload(owner.client, makePdf(LAB_TEXT));
  const reportId = uploaded.body.report.id;

  assert.equal((await other.client.get(`/api/reports/${reportId}`)).status, 404);
  assert.equal((await other.client.get(`/api/reports/${reportId}/download`)).status, 404);
  assert.equal((await other.client.delete(`/api/reports/${reportId}`)).status, 404);

  // The report is still there for its owner.
  assert.equal((await owner.client.get(`/api/reports/${reportId}`)).status, 200);
});

test('the owner can download the original file', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const buffer = makePdf(LAB_TEXT);
  const uploaded = await upload(client, buffer);
  const reportId = uploaded.body.report.id;

  const response = await client.get(`/api/reports/${reportId}/download`, { raw: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal(response.buffer.length, buffer.length);
});

test('the patient can confirm the extracted values', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const uploaded = await upload(client, makePdf(LAB_TEXT));
  const reportId = uploaded.body.report.id;
  const hemoglobin = uploaded.body.results.find((row) => row.testName === 'Hemoglobin');

  const response = await client.patch(`/api/reports/${reportId}/results`, {
    results: [{ id: hemoglobin.id, status: 'below_reference' }],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].verificationStatus, 'patient_confirmed');
});

test('deleting a report removes it', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const uploaded = await upload(client, makePdf(LAB_TEXT));
  const reportId = uploaded.body.report.id;

  assert.equal((await client.delete(`/api/reports/${reportId}`)).status, 200);
  assert.equal((await client.get(`/api/reports/${reportId}`)).status, 404);
});

test('uploading requires a signed-in patient', { skip }, async () => {
  const anonymous = fixture.server.createClient();
  const response = await upload(anonymous, makePdf(LAB_TEXT));
  assert.equal(response.status, 401);
});
