const money = (val) => {
    return Number(parseFloat(val).toFixed(2));
};

const add = (a, b) => money(a + b);
const sub = (a, b) => money(a - b);
const mul = (a, b) => money(a * b);
const div = (a, b) => money(a / b);

module.exports = {
    money,
    add,
    sub,
    mul,
    div
};