# Train Thinkora GPT

This folder contains a small character-level GPT trainer based on a decoder-only Transformer.

## 1. Prepare data

Create data.txt in the repository root and put a large plain-text corpus in it. Use text you own or are allowed to use. The model learns patterns from that corpus; it does not automatically learn facts or connect to Thinkora chat.

Do not commit private, sensitive, or copyrighted text. Keep large datasets and trained model weights out of Git.

## 2. Install

Create a Python virtual environment, then run:

    python -m pip install -r requirements-train.txt

Install a PyTorch build appropriate for your operating system and accelerator if the default package does not support it. The script uses CUDA when available; otherwise it runs on CPU.

## 3. Train

From the repository root, run:

    python training/train_gpt.py --data data.txt --steps 5000

Defaults mirror the supplied example: batch size 32, context 128, dimension 256, 4 attention heads, 4 Transformer blocks, and AdamW learning rate 0.0003.

Optional settings include --batch-size, --context, --dim, --heads, --layers, --sample-tokens, and --out.

The script prints training and validation loss, generates a sample, and saves a checkpoint under checkpoints/.

## 4. Limitations

This is an educational character-level language model, not a modern assistant model. Output quality depends heavily on dataset size and quality. The saved checkpoint is not yet connected to Thinkora's /api/chat service; that needs a separate inference backend and model-serving integration.

GitHub and Vercel do not train this model. Run training on a suitable local machine or a separate training service. Do not run a long training loop inside a Vercel serverless request.
