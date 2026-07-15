const test = require('node:test');
const assert = require('node:assert/strict');

const {
  upsertClient,
  markClientDisconnected,
  getClientRegistry,
} = require('../src/services/clientRegistryService');
const { buildPcCard } = require('../src/controllers/monitoringController');

test('heartbeat main process memantau PC sebelum siswa login', () => {
  const pcName = 'TEST-PRELOGIN-01';
  const entry = upsertClient({
    pc_name: pcName,
    socket_id: 'main-prelogin',
    power_state: 'awake',
    session_state: 'login',
    source: 'socket-heartbeat',
  });

  assert.equal(entry.is_online, true);
  assert.equal(entry.session_state, 'login');
  assert.equal(buildPcCard({ pcName, presence: entry }).status, 'locked');
});

test('status sleep bertahan ketika frame layar berhenti dan socket disconnect', () => {
  const pcName = 'TEST-SLEEP-01';
  upsertClient({
    pc_name: pcName,
    socket_id: 'main-sleep',
    power_state: 'sleeping',
    session_state: 'active',
    source: 'socket-power-state',
  });

  const afterScreenEvent = upsertClient({
    pc_name: pcName,
    source: 'socket-screen',
  });
  assert.equal(afterScreenEvent.power_state, 'sleeping');

  const disconnected = markClientDisconnected(pcName, 'main-sleep');
  assert.equal(disconnected.is_online, false);
  assert.equal(disconnected.power_state, 'sleeping');

  const card = buildPcCard({
    pcName,
    session: {
      id: 'session-sleep',
      student_id: 'student-1',
      nis: '10001',
      nama_lengkap: 'Siswa Uji',
      kelas: 'X',
      login_time: new Date(),
    },
    presence: disconnected,
  });
  assert.equal(card.status, 'sleeping');
  assert.equal(card.student.name, 'Siswa Uji');
});

test('resume mengembalikan status aktif dan disconnect socket lama diabaikan', () => {
  const pcName = 'TEST-RESUME-01';
  upsertClient({
    pc_name: pcName,
    socket_id: 'main-old',
    power_state: 'sleeping',
    session_state: 'active',
  });
  const resumed = upsertClient({
    pc_name: pcName,
    socket_id: 'main-new',
    power_state: 'awake',
    session_state: 'active',
  });

  assert.equal(markClientDisconnected(pcName, 'main-old'), null);
  const current = getClientRegistry().find((entry) => entry.pc_name === pcName);
  assert.equal(current.socket_id, 'main-new');
  assert.equal(current.is_online, true);
  assert.equal(current.power_state, 'awake');

  const activeCard = buildPcCard({
    pcName,
    session: {
      id: 'session-resume',
      student_id: 'student-2',
      nis: '10002',
      nama_lengkap: 'Siswa Bangun',
      kelas: 'XI',
      login_time: new Date(),
    },
    presence: resumed,
  });
  assert.equal(activeCard.status, 'active');
});
