var sample = 0
var testCount = 0
var samples = []
var actual = 0
var actuals = []

setInterval(function() {
  testCount += 1
  samples.push(sample);
  var sAvg = samples.reduce((total,v) => total+v) / samples.length;
  actuals.push(actual);
  var aAvg = actuals.reduce((total,v) => total+v) / actuals.length;
  console.log(`The sampled count was: ${sample} (avg ${sAvg}), and actual was ${actual} (avg ${aAvg})`);
  actual = 0
  sample = 0
}, 10*1000)

function doSample() {
  if (Math.random() <= 0.1) {
 	sample = sample + 10
  }
 }

function track() {
	actual = actual + 1
	doSample()
    setTimeout(track, Math.random() * 50)
}

setTimeout(track, Math.random() * 50)
