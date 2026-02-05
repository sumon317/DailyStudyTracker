
function safeId(id) {
    const strId = String(id);
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
        const char = strId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash) & 0x7FFFFFFF;
}

const base = Date.now();
const ids = [base, base + 1, base + 2, base + 100, base + 1000];
const hashed = ids.map(id => ({ orig: id, safe: safeId(id) }));

console.log(hashed);
const duplicates = hashed.some((val, i) => hashed.some((v, j) => i !== j && v.safe === val.safe));
console.log("Has duplicates:", duplicates);
