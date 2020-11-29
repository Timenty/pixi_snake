```javascript
var vector = (p1, p2) => ({ x: p2.x - p1.x, y: p2.y - p1.y });
const pDistance = vector => ({
    x: Math.abs(vector.x),
    y: Math.abs(vector.y),
});
var a = { x: 10, y: 10 };
var b = { x: 8, y: 8 };
var nA = { x: a.x + 2, y: a.x + 1 };
nA;
//{x: 12, y: 11}
vector(a, nA);
// {x: 2, y: 1}
var distance = vctor => ({
    x: Math.abs(vctor.x),
    y: Math.abs(vctor.y),
});
distance(vector(a, nA));
// {x: 2, y: 1}
var huitas = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) - Math.pow(p2.y - p1.y, 2));
huitas(a, nA);
// 1.7320508075688772
```
