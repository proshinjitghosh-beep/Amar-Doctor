import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './helpers/module-fixture.js';
import { stubFetch, jsonResponse } from './helpers/test-app.js';

const fixture = await createFixture('emergency');
const skip = fixture.available ? false : 'no test database configured';

const LOCATION = { lat: 23.8103, lng: 90.4125 };

async function addContact(client, overrides = {}) {
  return client.post('/api/emergency/contacts', {
    name: 'সালমা বেগম',
    relationship: 'স্ত্রী',
    phone: '01712345678',
    isPrimary: true,
    ...overrides,
  });
}

test.after(async () => {
  if (fixture.available) await fixture.close();
});

test('the emergency profile stores only what the patient entered', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const response = await client.put('/api/emergency/profile', {
    bloodGroup: 'B+',
    allergies: ['Penicillin'],
    conditions: ['Asthma'],
    emergencyNotes: 'ইনহেলার ব্যাগে আছে',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.profile.bloodGroup, 'B+');
  assert.deepEqual(response.body.profile.allergies, ['Penicillin']);
  assert.deepEqual(response.body.profile.conditions, ['Asthma']);
});

test('an invalid blood group is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await client.put('/api/emergency/profile', { bloodGroup: 'Z+' });
  assert.equal(response.status, 400);
});

test('a contact without a valid phone number is rejected', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await addContact(client, { phone: 'abc' });
  assert.equal(response.status, 400);
});

test('contacts can be added, listed and deleted', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const created = await addContact(client);
  assert.equal(created.status, 201);
  assert.equal(created.body.contact.name, 'সালমা বেগম');

  const list = await client.get('/api/emergency/contacts');
  assert.equal(list.body.contacts.length, 1);

  const removed = await client.delete(`/api/emergency/contacts/${created.body.contact.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await client.get('/api/emergency/contacts')).body.contacts.length, 0);
});

test('only one contact can be the primary one', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  await addContact(client, { name: 'প্রথম' });
  await addContact(client, { name: 'দ্বিতীয়' });

  const list = await client.get('/api/emergency/contacts');
  assert.equal(list.body.contacts.filter((contact) => contact.isPrimary).length, 1);
});

test('activating an SOS returns the 999 numbers and a shareable location', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const response = await client.post('/api/emergency/activate', {
    location: LOCATION,
    locationSource: 'device',
    notes: 'বুকে ব্যথা',
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.numbers.emergency, '999');
  assert.equal(response.body.numbers.ambulance, '999');
  assert.match(response.body.shareUrl, /23\.8103,90\.4125/);
  assert.match(response.body.message, /জরুরি সহায়তা/);
  // The app never claims that an ambulance was dispatched.
  assert.match(response.body.disclaimer, /অ্যাম্বুলেন্স পাঠায়নি/);
});

test('activating without a location still works and says the location is unknown', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const response = await client.post('/api/emergency/activate', {});
  assert.equal(response.status, 201);
  assert.equal(response.body.shareUrl, null);
  assert.match(response.body.message, /অবস্থান এখনো পাওয়া যায়নি/);
});

test('notifying contacts without a messaging channel is recorded as unavailable, never as sent', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  await addContact(client);

  const activated = await client.post('/api/emergency/activate', { location: LOCATION });
  const eventId = activated.body.event.id;

  const response = await client.post(`/api/emergency/${eventId}/notify`, {});
  assert.equal(response.status, 200);
  assert.equal(response.body.notifications.length, 1);
  assert.equal(response.body.notifications[0].status, 'unavailable');
  assert.notEqual(response.body.notifications[0].status, 'sent');
  assert.match(response.body.note, /নিজে পাঠান/);
});

test('a notification channel that is only prepared is recorded as pending, not as sent', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  await addContact(client);

  const activated = await client.post('/api/emergency/activate', { location: LOCATION });
  const eventId = activated.body.event.id;

  const response = await client.post(`/api/emergency/${eventId}/notify`, { channelAvailable: true });
  assert.equal(response.body.notifications[0].status, 'pending');
  assert.notEqual(response.body.notifications[0].status, 'sent');
});

test('an event can be resolved and appears in the history', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();
  const activated = await client.post('/api/emergency/activate', { location: LOCATION });
  const eventId = activated.body.event.id;

  const resolved = await client.post(`/api/emergency/${eventId}/resolve`, { notes: 'সুস্থ হয়ে গেছে' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.event.status, 'resolved');
  assert.ok(resolved.body.event.resolvedAt);

  const history = await client.get('/api/emergency/history');
  assert.equal(history.body.events.length, 1);
  assert.equal(history.body.events[0].status, 'resolved');
});

test('another patient cannot see or resolve somebody else\'s emergency event', { skip }, async () => {
  await fixture.reset();
  const owner = await fixture.registerPatient();
  const other = await fixture.registerPatient();

  const activated = await owner.client.post('/api/emergency/activate', { location: LOCATION });
  const eventId = activated.body.event.id;

  assert.equal((await other.client.post(`/api/emergency/${eventId}/notify`, {})).status, 404);
  assert.equal((await other.client.post(`/api/emergency/${eventId}/resolve`, {})).status, 404);
  assert.equal((await other.client.get('/api/emergency/history')).body.events.length, 0);
});

test('another patient cannot see or delete somebody else\'s contact', { skip }, async () => {
  await fixture.reset();
  const owner = await fixture.registerPatient();
  const other = await fixture.registerPatient();

  const contact = (await addContact(owner.client)).body.contact;
  assert.equal((await other.client.get('/api/emergency/contacts')).body.contacts.length, 0);
  assert.equal((await other.client.delete(`/api/emergency/contacts/${contact.id}`)).status, 404);
});

test('the emergency numbers come from the region configuration', { skip }, async () => {
  const { client } = await fixture.registerPatient();
  const response = await client.get('/api/emergency/profile');
  assert.equal(response.status, 200);
  assert.equal(response.body.numbers.region, 'bd');
  assert.equal(response.body.numbers.emergency, '999');
});

test('nearby hospitals come from a real provider and fall back honestly', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const stub = stubFetch(
    async () =>
      jsonResponse({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 23.82,
            lon: 90.42,
            tags: { name: 'Dhaka General Hospital', 'amenity': 'hospital', phone: '+8801711000000', emergency: 'yes' },
          },
        ],
      }),
    { match: (url) => url.includes('overpass') }
  );
  try {
    const response = await client.get(`/api/emergency/hospitals?lat=${LOCATION.lat}&lng=${LOCATION.lng}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.hospitals.length, 1);
    assert.equal(response.body.hospitals[0].name, 'Dhaka General Hospital');
    assert.equal(response.body.hospitals[0].phone, '+8801711000000');
    // Availability is never claimed.
    assert.equal(response.body.source, 'OpenStreetMap (Overpass)');
    assert.match(response.body.availabilityNote, /খোলা আছে কি না তা এই তথ্যে নেই/);
  } finally {
    stub.restore();
  }
});

test('when the hospital provider fails the response falls back to a map search', { skip }, async () => {
  await fixture.reset();
  const { client } = await fixture.registerPatient();

  const stub = stubFetch(
    async () => {
      throw new TypeError('fetch failed');
    },
    { match: (url) => url.includes('overpass') }
  );
  try {
    const response = await client.get(`/api/emergency/hospitals?lat=${LOCATION.lat}&lng=${LOCATION.lng}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.hospitals.length, 0);
    assert.ok(response.body.fallbackUrl);
    assert.match(response.body.note, /লোড করা যাচ্ছে না/);
  } finally {
    stub.restore();
  }
});

test('the emergency endpoints require a signed-in patient', { skip }, async () => {
  const anonymous = fixture.server.createClient();
  assert.equal((await anonymous.get('/api/emergency/profile')).status, 401);
  assert.equal((await anonymous.post('/api/emergency/activate', {})).status, 401);
  assert.equal((await anonymous.get('/api/emergency/history')).status, 401);
});
