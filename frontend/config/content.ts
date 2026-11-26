export const projectName = "SIGHTLINE";

// The 15 MVTec AD objects named in the problem statement. Any other name (e.g. a webcam part) also works.
export const objectCategories = [
  { id: "bottle", name: "Bottle", code: "BTL" },
  { id: "cable", name: "Cable", code: "CBL" },
  { id: "capsule", name: "Capsule", code: "CPS" },
  { id: "carpet", name: "Carpet", code: "CRP" },
  { id: "grid", name: "Grid", code: "GRD" },
  { id: "hazelnut", name: "Hazelnut", code: "HZN" },
  { id: "leather", name: "Leather", code: "LTH" },
  { id: "metal_nut", name: "Metal nut", code: "NUT" },
  { id: "pill", name: "Pill", code: "PIL" },
  { id: "screw", name: "Screw", code: "SCR" },
  { id: "tile", name: "Tile", code: "TIL" },
  { id: "toothbrush", name: "Toothbrush", code: "TBR" },
  { id: "transistor", name: "Transistor", code: "TRN" },
  { id: "wood", name: "Wood", code: "WOD" },
  { id: "zipper", name: "Zipper", code: "ZIP" },
] as const;

export const sampleImagePaths = [
  "/images/sample-metal-part.png",
  "/images/sample-pcb.png",
  "/images/sample-bearing.png",
  "/images/sample-connector.png",
  "/images/sample-gear.png",
  "/images/sample-valve.png",
];

export const layerCopy = [
  { title: "Input photo", detail: "The original image, exactly as it was captured." },
  { title: "Pre-processing", detail: "The photo is normalised to make lighting more consistent." },
  { title: "Feature map", detail: "A visual summary of edges, texture and part geometry." },
  { title: "Good-part memory", detail: "A reference built only from the good examples you provide." },
  { title: "Anomaly map", detail: "Areas that differ most from learned good parts." },
];

export const steps = [
  { number: "01", title: "Show good photos", text: "Add clear photos of parts that meet your quality standard. No defective examples needed." },
  { number: "02", title: "It learns normal appearance", text: "Netrix IQ builds a reference for shape, surface and texture from your good parts." },
  { number: "03", title: "A new photo arrives", text: "Inspect a part using the same camera position and lighting as your training photos." },
  { number: "04", title: "Differences are highlighted", text: "See a Good or Defective result and review the areas that differ from the reference." },
];

export const minimumGoodImages = 5;
export const maxTrainingFiles = 1000;
export const trainingInstruction = "Upload photos of correctly made parts only. Do not include defective parts.";
// measured on all 15 MVTec AD objects, resnet18, Colab CPU (slower than a typical laptop)
export const projectTargets = [
  { id: "objects", target: "15 objects", detail: "Object categories supported", measured: "15 / 15" },
  { id: "learning", target: "≤ 10 min to learn", detail: "Good-part training budget", measured: "68 s max" },
  { id: "latency", target: "< 1 s per photo", detail: "Inspection time target", measured: "249 ms worst" },
  { id: "runtime", target: "Laptop CPU · no GPU · offline", detail: "Target runtime environment", measured: "CPU, offline" },
] as const;
export const measuredAccuracy = { auroc: "0.960", accuracy: "0.881", recall: "88.7%" };
export const trainingMinimumCopy = {
  insufficient: "good reference images still needed",
  ready: "Minimum met. Keep defective parts out of the training set.",
} as const;
export const runtimeTargetCopy = "Runs on this laptop. No internet, no GPU.";
export const limitationCopy = [
  "Results depend on consistent photo lighting and camera angle.",
  "Unseen defect types are highlighted as differences, not named.",
  "The 3D view is a relief built from one photo and the model’s scores, not a 3D scan of the part.",
  "Textures (wood, leather) get the most false alarms; “This was actually good” fixes each one instantly.",
  "Screw is the weakest object (accuracy 0.70): tiny defects on a part that lies at any angle.",
] as const;
export const teamNamePlaceholder = "CodeStorm";
export const hackathonName = "Synapse 2.0";
export const trainingBudgetSeconds = 600;
export const navigationItems = [
  { label: "Method", href: "#method", section: "method" },
  { label: "Train", href: "#train", section: "train" },
  { label: "Objects", href: "#tools", section: "tools", tab: "objects" },
  { label: "Inspect", href: "#inspect", section: "inspect" },
  { label: "Evaluation", href: "#tools", section: "tools", tab: "evaluation" },
  { label: "History", href: "#history", section: "history" },
] as const;
export const trainingErrorCopy = "Training could not start. Check the selected photos and try again.";
export const objectViewCopy = {
  title: "Object library",
  description: "Training state reported by the inspection server.",
  sampleBadge: "LIVE",
  empty: "No object status is available yet.",
  error: "Object status could not be loaded. Is the inspection server running?",
  unavailable: "Status unavailable",
  imageCountUnavailable: "Image count unavailable",
  trainedImages: (count: number) => `${count} good images`,
  untrainedImages: "0 good images",
  lastTrained: "LAST TRAINED",
  demoNote: "Trained models are saved on this laptop and load again after a restart.",
} as const;
export const evaluationCopy = {
  title: "Evaluation",
  description: "Upload labelled good and defective image folders to assess a trained object.",
  instruction: "Each photo runs through the model as a plain yes/no at the line. Evaluation photos are not added to the shift log.",
  backendBadge: "LIVE",
  goodFolder: "Good parts folder",
  chooseGoodFolder: "Choose a folder of labelled good images",
  defectiveFolder: "Defective parts folder",
  chooseDefectiveFolder: "Choose a folder of labelled defective images",
  selectedImages: (count: number) => `${count} image files selected`,
  runButton: "Run evaluation",
  runningButton: "Running evaluation",
  summaryTitle: "Confusion summary",
  outcomeColumn: "Outcome",
  countColumn: "Count",
  correct: "Correct",
  missedDefects: "Missed defects",
  falseAlarms: "False alarms",
  empty: "No evaluation run yet. Choose both folders and start a run.",
  error: "Evaluation could not run. Train this object first, and check the inspection server is running.",
} as const;
export const limitationTitle = "Limitations";
export const limitationsEyebrow = "REAL-WORLD NOTES";
export const runtimeStatusCopy = "The model runs on this laptop. The page talks to it at localhost, so it works with the Wi-Fi off.";
export const runtimeOnlineLabel = "Browser online";
export const runtimeOfflineLabel = "Browser offline";
export const runtimeIndicatorLabel = "navigator.onLine";
export const runtimeTargetLabel = "MEASURED";
export const projectTargetsLabel = "PROJECT TARGETS";
export const measuredLabel = "MEASURED";
export const sampleDataLabel = "LIVE";
export const demoModeLabel = "MODEL CONNECTED";
export const layerLegendHeading = "LAYERS";
export const explodeLabel = "Explode";
export const collapseLabel = "Collapse";
export const toolsSectionTitle = "Evaluation and objects.";
export const toolsSectionDescription = "Run a labelled evaluation or review the learning state reported for each object.";
export const systemSectionTitle = "System requirements.";
export const systemSectionDescription = "Project targets are shown beside values returned by a connected backend.";
export const historyLoadingCopy = "Loading recent inspections…";
export const historyErrorCopy = "Inspection history is unavailable. Try again after reconnecting the data service.";

export const pageCopy = {
  brandDescriptor: "VISUAL INSPECTION SYSTEM",
  onlineStatus: "ONLINE",
  offlineStatus: "OFFLINE",
  evaluationTab: "Evaluation",
  objectsTab: "Objects",
  resultIdPending: "ID ————",
  heroEyebrow: "MACHINE VISION / LOCAL FIRST",
  heroHeadline: "Teach it what good looks like.",
  heroEmphasis: "It spots everything else.",
  heroSubtitle: "Trains on good parts only. Runs offline on an ordinary laptop.",
  tryInspector: "Try the inspector",
  trainNewPart: "Train on a new part",
  previewNote: "Hero figure is an illustration. Everything below runs the real model.",
  heroFigure: "FIG 01 / ANOMALY DETECTION PIPELINE",
  scrollPrompt: "SCROLL TO EXPLORE",
  methodTitle: "From good parts to clear answers.",
  methodDescription: "A simple workflow. Your good parts define the standard.",
  processTag: "01—04 / PROCESS",
  referenceObject: "REFERENCE OBJECT / FASTENER-01",
  referenceDiameter: "Ø 12.0 MM",
  referenceImageNumber: "IMAGE 01 / 05",
  goodReference: "GOOD REFERENCE",
  trainingTitle: "Teach a new part.",
  trainingDescription: "Start with good examples. Netrix IQ learns the normal surface and shape.",
  localConsole: "LOCAL CONSOLE",
  trainingSetup: "Training setup",
  trainingSetupDescription: "Choose an object and add its good reference photos.",
  objectCategory: "OBJECT CATEGORY",
  goodPhotos: "GOOD REFERENCE PHOTOS",
  imageCountLabel: "GOOD IMAGES",
  dropGoodPhotos: "Drop good photos here",
  browseGoodPhotos: "or browse files · JPG, PNG, WEBP",
  timeLimit: "TIME LIMIT",
  trainingLearning: "Learning normal appearance",
  trainingComplete: "Learning complete",
  trainingErrorTitle: "Training error",
  trainingReady: "Ready to learn",
  trainingLearningDetail: (count: number) => `${count} good photos · building the good-part memory`,
  trainingCompleteDetail: (status: string) => `${status} · measured on this laptop`,
  trainingReadyDetail: (minimum: number) => `Add ${minimum} correctly made images to begin.`,
  learningButton: "Learning",
  startLearning: "Start learning",
  runAgain: "Run again",
  trainingConsoleNote: "Training runs on this laptop and uses good photos only, not even fake defects.",
  inspectTitle: "Inspect a part.",
  inspectDescription: "Compare one new photo against the good-part reference.",
  demoBannerTitle: "Connected to the local model",
  demoBannerDescription: "Every result below comes from the model running on this laptop.",
  inspectionInput: "Inspection input",
  inspectionInputDescription: "Upload a photo of a new part, or take one with the webcam.",
  uploadPhoto: "Upload a photo",
  imageFormats: "JPG, PNG or WEBP",
  sampleImageEyebrow: "OR USE THE WEBCAM",
  sampleFastener: "Fastener / Sample 01",
  runInspection: "Run inspection",
  runningInspection: "Inspecting photo",
  inspectionResult: "INSPECTION RESULT",
  demoOutput: "LIVE OUTPUT",
  classification: "CLASSIFICATION",
  currentStatus: "STATUS",
  latencyPass: "PASS / < 1 S TARGET",
  latencyFail: "FAIL / 1 S TARGET",
  anomalyScore: "ANOMALY SCORE",
  latency: "LATENCY",
  decisionThreshold: "DECISION THRESHOLD",
  heatmapHeading: "AREAS THAT DIFFER FROM LEARNED GOOD PARTS",
  heatmapOpacity: "HEATMAP OPACITY",
  defectOutline: "Defect outline",
  layersOn: "Layers on",
  layersOff: "Layers off",
  layerViewLabel: "LAYER VIEW / HEATMAP",
  originalHeatmapLabel: "ORIGINAL + HEATMAP",
  resultExplanation: "The highlighted area differs most from learned good parts.",
  resultWaiting: "Awaiting image",
  resultComparing: "Comparing surface details…",
  historyTitle: "Run history.",
  historyDescription: "Every inspection, stored on this laptop with its heatmap.",
  historyFilter: "Filter inspections by verdict",
  historyAll: "All results",
  historyExport: "Export CSV",
  historyColumns: ["IMAGE / ID", "OBJECT", "VERDICT", "SCORE", "TIME", "INSPECTED AT"],
  csvHeaders: ["ID", "Object", "Verdict", "Score", "Threshold", "Latency (ms)", "Time"],
  historyNoMatch: "No inspections match this filter.",
  historySession: "SAVED ON THIS LAPTOP",
  systemTargetsLabel: "TARGETS · MEASURED ON MVTEC AD",
  targetDisclaimer: "Measured on all 15 MVTec AD objects with resnet18 on a Colab CPU, which is slower than a typical laptop. Mean image AUROC 0.960, accuracy 0.881.",
  teamPrefix: "TEAM",
  demoVersion: "v1.0 / LOCAL MODEL",
  sectionLabel: "SECTION",
  openInspector: "Open inspector",
  toolsTablistLabel: "Evaluation and object views",
  selectedObjectCount: "15 MVTEC AD OBJECTS",
  apiStatus: "API / CONNECTED",
  objectSelectLabel: "OBJECT",
  goodVerdict: "Good",
  unsureVerdict: "Unsure",
  retakeVerdict: "Retake",
  defectiveVerdict: "Defective",
  historyRecordCount: (count: number) => `${count} RECORDS SHOWN`,
  noGpuFootnote: "NO GPU REQUIRED*",
} as const;
