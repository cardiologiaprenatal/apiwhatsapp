const fs = require('fs');
const j = JSON.parse(fs.readFileSync('/tmp/out.json', 'utf8'));
const arr = Array.isArray(j) ? j : [j];
for (const w of arr) {
  console.log(`id=${w.id} active=${w.active} name=${w.name}`);
}
