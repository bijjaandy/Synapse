"""Run once while online. Saves ImageNet backbone weights so the inspector runs with no internet.
  python download_weights.py                    # resnet18 (small, default)
  python download_weights.py wide_resnet50      # bigger, more accurate (~270 MB)
"""
import sys

import torch
from torchvision.models import ResNet18_Weights, Wide_ResNet50_2_Weights, resnet18, wide_resnet50_2

from inspector import WEIGHTS_DIR

SOURCES = {"resnet18": lambda: resnet18(weights=ResNet18_Weights.IMAGENET1K_V1),
           "wide_resnet50": lambda: wide_resnet50_2(weights=Wide_ResNet50_2_Weights.IMAGENET1K_V1)}

names = sys.argv[1:] or ["resnet18"]
WEIGHTS_DIR.mkdir(exist_ok=True)
for name in names:
    if name not in SOURCES:
        sys.exit(f"unknown backbone {name}; choose from {list(SOURCES)}")
    path = WEIGHTS_DIR / f"{name}.pth"
    torch.save(SOURCES[name]().state_dict(), path)
    print("saved", path)