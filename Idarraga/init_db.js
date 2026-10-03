// init_db.js
// Creates data/app.json with a simple structure for storage (phrases, templates, fields, events)
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.json');

if (fs.existsSync(dbPath)) {
  console.log('Database file already exists at', dbPath);
} else {
  const init = {
    phrases: [],
    templates: [],
    fields: [],
    events: []
  };
  fs.writeFileSync(dbPath, JSON.stringify(init, null, 2), 'utf8');
  console.log('Created JSON DB at', dbPath);
}
