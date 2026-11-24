/** One entry per provider event identity. Updating a tool never moves it past newer messages. */
function createTimeline() {
  const rows = new Map();

  function update(id, type, fields) {
    const previous = rows.get(id);
    const row = { id, type, ...previous, ...fields };
    rows.set(id, row);
    return row;
  }

  function text(id, type, value, { append = false, status = 'done' } = {}) {
    const previous = rows.get(id);
    if (typeof value !== 'string' || !value) {
      if (previous) update(id, type, { status });
      return;
    }
    update(id, type, { text: append ? (previous?.text || '') + value : value, status });
  }

  function tool(id, fields) {
    const next = { ...fields };
    if (next.label) next.label = String(next.label).slice(0, 300);
    if (typeof next.output === 'string') next.output = next.output.slice(0, 5000);
    else delete next.output;
    update(id, 'tool', next);
  }

  function finish(status = 'done') {
    for (const row of rows.values()) {
      if (row.status === 'running' || row.status === 'pending') {
        row.status = row.type === 'tool' && status === 'done' ? 'stopped' : status;
      }
    }
  }

  function snapshot() {
    const timeline = Array.from(rows.values(), (row) => ({ ...row }));
    const transcript = (type) => timeline.filter((row) => row.type === type)
      .map((row) => row.text).filter(Boolean).join('\n\n');
    return {
      answer: transcript('message'),
      thinking: transcript('thought'),
      activity: timeline.filter((row) => row.type === 'tool').map(({ kind, label, status }) => ({ kind, label, status })),
      timeline,
    };
  }

  return { update, text, tool, finish, snapshot, has: (id) => rows.has(id) };
}

module.exports = { createTimeline };
