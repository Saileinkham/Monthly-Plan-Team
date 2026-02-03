const localStorageMock = {
    store: {},
    getItem: function(key) { return this.store[key] || null; },
    setItem: function(key, value) { this.store[key] = value.toString(); },
    removeItem: function(key) { delete this.store[key]; }
};
global.localStorage = localStorageMock;

let currentUser = { username: 'admin', role: 'admin' };
let viewingUser = 'user1';
let dayOffs = [];
let users = [{username: 'admin'}, {username: 'user1'}];

function getPrefix() {
    return currentUser.role === 'admin' && viewingUser ? viewingUser + '_' : currentUser.username + '_';
}

function save() {
    const prefix = getPrefix();
    localStorage.setItem(prefix + 'dayOffs', JSON.stringify(dayOffs));
    console.log('Saved to', prefix + 'dayOffs', ':', JSON.stringify(dayOffs));
}

function load() {
    const prefix = getPrefix();
    dayOffs = JSON.parse(localStorage.getItem(prefix + 'dayOffs')) || [];
    console.log('Loaded from', prefix + 'dayOffs', ':', JSON.stringify(dayOffs));
}

// Scenario: Admin views User1, adds leave, switches view, switches back
console.log('--- Step 1: Admin views User1 ---');
viewingUser = 'user1';
load(); // Should be empty initially
dayOffs.push('2026-02-05');
save();

console.log('--- Step 2: Admin views All ---');
viewingUser = 'all';
// Logic for All view loading
let allDayOffs = [];
users.forEach(u => {
    const uDayOffs = JSON.parse(localStorage.getItem(u.username + '_dayOffs')) || [];
    console.log('Aggregating', u.username, uDayOffs);
    allDayOffs = [...allDayOffs, ...uDayOffs];
});
console.log('All View DayOffs:', allDayOffs);

console.log('--- Step 3: Admin views User1 again ---');
viewingUser = 'user1';
load(); // Should have data
