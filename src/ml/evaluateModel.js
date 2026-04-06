const generateDataset = require("./generateDataset");
const predictTamper = require("../utils/predictTamper");

(async () => {
  const data = await generateDataset();

  let tp=0, fp=0, fn=0, tn=0;

  data.forEach(d => {
    const res = predictTamper(d.features).risk === "HIGH" ? 1 : 0;
    if (res===1 && d.label===1) tp++;
    else if (res===1 && d.label===0) fp++;
    else if (res===0 && d.label===1) fn++;
    else tn++;
  });

  console.log("Precision:", tp/(tp+fp));
  console.log("Recall:", tp/(tp+fn));
  console.log("Accuracy:", (tp+tn)/(tp+tn+fp+fn));
})();
