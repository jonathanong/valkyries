const ITERATIONS = 1_000_000;
const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };

console.time("for...in Object.prototype");
for (let i = 0; i < ITERATIONS; i++) {
  let count = 0;
  for (const name in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) {
      count += obj[name as keyof typeof obj];
    }
  }
}
console.timeEnd("for...in Object.prototype");

console.time("for...in hasOwn");
for (let i = 0; i < ITERATIONS; i++) {
  let count = 0;
  for (const name in obj) {
    if (Object.hasOwn(obj, name)) {
      count += obj[name as keyof typeof obj];
    }
  }
}
console.timeEnd("for...in hasOwn");
