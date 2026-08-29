const assert = require('node:assert/strict');
const test = require('node:test');
const { networkAttention } = require('../push-service');

test('player count changes do not create push attention', () => {
  assert.equal(networkAttention(
    { state: 'ONLINE', players: 1 },
    { state: 'ONLINE', players: 2, label: 'Survival' },
  ), null);
});

test('routine lifecycle transitions stay silent', () => {
  for (const [from, to] of [['OFFLINE', 'STARTING'], ['STARTING', 'ONLINE'], ['ONLINE', 'STANDBY']]) {
    assert.equal(networkAttention({ state: from }, { state: to, label: 'Lobby' }), null);
  }
});

test('error and unexpected offline transitions create attention', () => {
  const error = networkAttention({ state: 'ONLINE' }, { state: 'ERROR', label: 'Lobby' });
  assert.equal(error.rule, 'health');
  const offline = networkAttention({ state: 'ONLINE' }, { state: 'OFFLINE', label: 'Lobby' });
  assert.equal(offline.rule, 'serverStatus');
  assert.equal(networkAttention({ state: 'STANDBY' }, { state: 'OFFLINE', label: 'Lobby' }), null);
});
