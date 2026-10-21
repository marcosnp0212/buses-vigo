// Assembles the network app: template + CSS + shared blocks + data.
const fs = require('fs');
const path = require('path');
const d = __dirname;
const r = (f) => fs.readFileSync(path.join(d, f), 'utf8');
let t = r('app2-template.html');
t = t.replace('/*BASECSS*/', () => r('base.css'))
  .replace('/*TRIPBLOCK*/', () => r('tripblock2.js'))
  .replace('/*LOCATE*/', () => r('locate.js'))
  .replace('/*ALERT*/', () => r('alert.js'));
const js = t.match(/<script>([\s\S]*)<\/script>/)[1];
new Function(js.replace('/*NET*/{}', '{lines:[],routes:[],stops:{}}').replace('/*SCHED*/{}', '{}')); // syntax check
t = t.replace('/*NET*/{}', () => r(process.argv[2] || 'network.json')).replace('/*SCHED*/{}', () => r('sched-gtfs.json'));
fs.writeFileSync(process.argv[3], t);
console.log('ok', (t.length / 1024).toFixed(0), 'KB');
