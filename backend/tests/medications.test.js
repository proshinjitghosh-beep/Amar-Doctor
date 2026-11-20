import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, makePdf } from './helpers/module-fixture.js';

const fixture = await createFixture('meds');
const skip = fixture.available ? false : 'no test database configured';

async function addMedication(client, overrides = {}) {
  const response = await client.post('/api/medications', {
    medicineName: 'Napa Extra',
    dosage: '500mg',
    instructions: 'খাবারের পরে',
    quantityOnHand: 30,
    ...overrides,
  });
  return response;
}

test.after(async () => {
  if (fixture.available) await fixture.close();
});

test('a medicine can be added and listed', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const created = await addMedication(client);
  assert.equal(created.status, 201);
  assert.equal(created.body.medication.medicineName, 'Napa Extra');
  assert.equal(created.body.medication.verificationStatus, 'patient_confirmed');

  const list = await client.get('/api/medications');
  assert.equal(list.status, 200);
  assert.equal(list.body.medications.length, 1);
});

test('a medicine without a name is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await client.post('/api/medications', { dosage: '500mg' });
  assert.equal(response.status, 400);
});

test('a schedule creates dose rows in the schedule timezone', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;

  const schedule = await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '08:30',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });
  assert.equal(schedule.status, 201);
  assert.equal(schedule.body.schedule.reminderTime, '08:30');

  const reminders = await client.get('/api/reminders');
  assert.equal(reminders.status, 200);
  assert.ok(reminders.body.reminders.length > 0);

  // 08:30 in Dhaka (UTC+6) is 02:30 UTC.
  const first = reminders.body.reminders[reminders.body.reminders.length - 1];
  const utcHour = new Date(first.scheduledAt).getUTCHours();
  assert.equal(utcHour, 2);
  assert.equal(new Date(first.scheduledAt).getUTCMinutes(), 30);
});

test('doses are materialised only once, however often the list is requested', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const first = (await client.get('/api/reminders')).body.reminders;
  const second = (await client.get('/api/reminders')).body.reminders;
  assert.equal(first.length, second.length);

  const keys = new Set(first.map((dose) => `${dose.medicationId}|${dose.scheduledAt}`));
  assert.equal(keys.size, first.length, 'no duplicate dose rows');
});

test('a dose is recorded as taken with the time the server recorded', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const reminders = (await client.get('/api/reminders')).body.reminders;
  const dose = reminders[0];

  const response = await client.post(`/api/reminders/${dose.id}/taken`);
  assert.equal(response.status, 200);
  assert.equal(response.body.reminder.status, 'taken');
  assert.ok(response.body.reminder.takenAt, 'the server records when the dose was taken');
});

test('a dose can be skipped', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });
  const dose = (await client.get('/api/reminders')).body.reminders[0];

  const response = await client.post(`/api/reminders/${dose.id}/skipped`);
  assert.equal(response.body.reminder.status, 'skipped');
});

test('snoozing moves the dose and never marks it as taken', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });
  const dose = (await client.get('/api/reminders')).body.reminders[0];

  const response = await client.post(`/api/reminders/${dose.id}/snooze`, { minutes: 30 });
  assert.equal(response.status, 200);
  assert.equal(response.body.reminder.status, 'snoozed');
  assert.equal(response.body.reminder.takenAt, null);

  const original = new Date(dose.scheduledAt).getTime();
  const moved = new Date(response.body.reminder.scheduledAt).getTime();
  assert.equal(moved - original, 30 * 60 * 1000);
});

test('adherence is computed from the recorded doses', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  // The doses are listed chronologically, so the first ones are the ones that
  // have already come due - those are the ones adherence measures.
  const doses = (await client.get('/api/reminders')).body.reminders;
  const past = doses.filter((dose) => new Date(dose.scheduledAt) <= new Date());
  assert.ok(past.length >= 2, 'the timeline contains doses that have already come due');

  await client.post(`/api/reminders/${past[0].id}/taken`);
  await client.post(`/api/reminders/${past[1].id}/skipped`);

  const adherence = await client.get('/api/medications/adherence?days=30');
  assert.equal(adherence.status, 200);
  assert.equal(adherence.body.adherence.taken, 1);
  assert.equal(adherence.body.adherence.skipped, 1);
  assert.equal(adherence.body.adherence.adherencePercent, 50);
});

test('the refill estimate is labelled as an estimate', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client, { quantityOnHand: 10 })).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const response = await client.get('/api/medications/refill-status');
  assert.equal(response.status, 200);
  assert.equal(response.body.refill.estimate, true);
  assert.equal(response.body.refill.items.length, 1);
  assert.equal(response.body.refill.items[0].estimatedDaysRemaining, 10);
  assert.equal(response.body.refill.items[0].dosesPerDay, 1);
});

test('a medicine without a schedule has no invented estimate', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  await addMedication(client, { quantityOnHand: 10 });

  const response = await client.get('/api/medications/refill-status');
  assert.equal(response.body.refill.items.length, 1);
  assert.equal(response.body.refill.items[0].estimatedDaysRemaining, null);
  assert.match(response.body.refill.items[0].note, /সময়সূচি/);
});

test('another patient cannot see or change a medicine', { skip }, async () => {
  await fixture.reset();
  const owner = await fixture.registerPatient();
  const other = await fixture.registerPatient();

  const medication = (await addMedication(owner.client)).body.medication;
  assert.equal((await other.client.get(`/api/medications/${medication.id}`)).status, 404);
  assert.equal((await other.client.put(`/api/medications/${medication.id}`, { medicineName: 'X' })).status, 404);
  assert.equal((await other.client.delete(`/api/medications/${medication.id}`)).status, 404);
  assert.equal((await other.client.get('/api/medications')).body.medications.length, 0);
});

test('discontinuing keeps the history and deactivates the schedule', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const response = await client.delete(`/api/medications/${medication.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.medication.status, 'discontinued');

  const list = await client.get('/api/medications');
  const found = list.body.medications.find((item) => item.id === medication.id);
  assert.equal(found.status, 'discontinued');
  assert.deepEqual(found.schedules, []);
});

test('a prescription upload returns candidates for review and saves nothing', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const form = new FormData();
  form.append('file', new Blob([makePdf(['Rx', 'Tab Napa Extra 500mg', '1 tab after meal'])], { type: 'application/pdf' }), 'rx.pdf');
  const response = await client.post('/api/medications/extract-prescription', form);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.candidates));
  assert.match(response.body.note, /যাচাই/);
  // Nothing was saved.
  assert.equal((await client.get('/api/medications')).body.medications.length, 0);
});

test('a clinician prescription is stored as clinician_confirmed', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const response = await client.post('/api/medications/import-prescription', {
    medicineName: 'Seclo 20',
    dosage: '20mg',
    instructions: 'খাবারের ৩০ মিনিট আগে',
    doctorName: 'ডা. তানভীর আহমেদ',
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.medication.verificationStatus, 'clinician_confirmed');
  // Importing a prescription must not create a schedule by itself.
  assert.deepEqual(response.body.medication.schedules, []);
});

test('the reminder dispatcher never creates a duplicate notification', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const { dispatchDueReminders } = await import('../src/services/reminder-dispatcher.service.js');
  const first = await dispatchDueReminders();
  const second = await dispatchDueReminders();

  assert.equal(first.created, 1, 'the first run notifies the due dose');
  assert.equal(second.created, 0, 'the second run creates nothing new');

  const notifications = await client.get('/api/notifications');
  assert.equal(notifications.status, 200);
  const keys = new Set(notifications.body.notifications.map((n) => `${n.medicationId}|${n.scheduledAt}`));
  assert.equal(keys.size, notifications.body.notifications.length, 'no duplicate notifications');
});

test('a notification is never recorded as sent when no push channel is configured', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const medication = (await addMedication(client)).body.medication;
  await client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });

  const { dispatchDueReminders } = await import('../src/services/reminder-dispatcher.service.js');
  await dispatchDueReminders();

  const notifications = await client.get('/api/notifications');
  for (const notification of notifications.body.notifications) {
    assert.notEqual(notification.status, 'sent');
    assert.ok(['pending', 'failed', 'unavailable'].includes(notification.status));
  }
});

test('a second patient cannot mark the first patient\'s dose as taken', { skip }, async () => {
  await fixture.reset();
  const owner = await fixture.registerPatient();
  const other = await fixture.registerPatient();

  const medication = (await addMedication(owner.client)).body.medication;
  await owner.client.post('/api/reminders', {
    medicationId: medication.id,
    reminderTime: '09:00',
    repeatDays: '0,1,2,3,4,5,6',
    timezone: 'Asia/Dhaka',
  });
  const dose = (await owner.client.get('/api/reminders')).body.reminders[0];

  assert.equal((await other.client.post(`/api/reminders/${dose.id}/taken`)).status, 404);
});
