#!/usr/bin/env python3
"""Train a small character-level GPT from a plain-text corpus."""
from __future__ import annotations
import argparse, random
from pathlib import Path
import torch
import torch.nn as nn
import torch.nn.functional as F

def parse_args():
    p = argparse.ArgumentParser(description="Train Thinkora's character-level GPT")
    p.add_argument('--data', type=Path, default=Path('data.txt'))
    p.add_argument('--out', type=Path, default=Path('checkpoints/thinkora-gpt.pt'))
    p.add_argument('--steps', type=int, default=5000)
    p.add_argument('--batch-size', type=int, default=32)
    p.add_argument('--context', type=int, default=128)
    p.add_argument('--dim', type=int, default=256)
    p.add_argument('--heads', type=int, default=4)
    p.add_argument('--layers', type=int, default=4)
    p.add_argument('--learning-rate', type=float, default=3e-4)
    p.add_argument('--sample-tokens', type=int, default=300)
    p.add_argument('--eval-interval', type=int, default=200)
    p.add_argument('--seed', type=int, default=1337)
    return p.parse_args()

class Block(nn.Module):
    def __init__(self, dim, heads):
        super().__init__()
        self.ln1, self.ln2 = nn.LayerNorm(dim), nn.LayerNorm(dim)
        self.att = nn.MultiheadAttention(dim, heads, batch_first=True)
        self.ff = nn.Sequential(nn.Linear(dim, 4 * dim), nn.GELU(), nn.Linear(4 * dim, dim))
    def forward(self, x):
        n = x.size(1)
        mask = torch.triu(torch.ones(n, n, device=x.device, dtype=torch.bool), diagonal=1)
        h = self.ln1(x)
        x = x + self.att(h, h, h, attn_mask=mask, need_weights=False)[0]
        return x + self.ff(self.ln2(x))

class GPT(nn.Module):
    def __init__(self, vocab_size, context, dim, heads, layers):
        super().__init__()
        if dim % heads: raise ValueError('--dim must be divisible by --heads')
        self.context = context
        self.tok, self.pos = nn.Embedding(vocab_size, dim), nn.Embedding(context, dim)
        self.blocks = nn.Sequential(*[Block(dim, heads) for _ in range(layers)])
        self.ln, self.head = nn.LayerNorm(dim), nn.Linear(dim, vocab_size)
    def forward(self, x, y=None):
        if x.size(1) > self.context: raise ValueError('Input exceeds context window')
        pos = torch.arange(x.size(1), device=x.device)
        logits = self.head(self.ln(self.blocks(self.tok(x) + self.pos(pos))))
        loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1)) if y is not None else None
        return logits, loss

def main():
    a = parse_args()
    if a.steps < 1 or a.context < 2 or a.batch_size < 1: raise SystemExit('Invalid training settings.')
    random.seed(a.seed); torch.manual_seed(a.seed)
    if not a.data.is_file(): raise SystemExit(f'Dataset not found: {a.data}. Create data.txt in the repository root.')
    text = a.data.read_text(encoding='utf-8')
    if len(text) < a.context + 2: raise SystemExit(f'Dataset needs at least {a.context + 2} characters.')
    chars = sorted(set(text)); stoi = {c:i for i,c in enumerate(chars)}; itos = {i:c for c,i in stoi.items()}
    data = torch.tensor([stoi[c] for c in text], dtype=torch.long)
    split = max(a.context + 1, int(0.9 * len(data))); split = min(split, len(data)-1)
    train_data, val_data = data[:split], data[split:]
    if len(val_data) < a.context + 1: train_data = val_data = data
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'Device: {device} | characters: {len(chars)} | corpus: {len(text):,}')
    print(f'Model: {a.layers} blocks, {a.heads} heads, dimension {a.dim}, context {a.context}')
    def batch(source):
        starts = torch.randint(0, len(source)-a.context, (a.batch_size,))
        x = torch.stack([source[i:i+a.context] for i in starts])
        y = torch.stack([source[i+1:i+a.context+1] for i in starts])
        return x.to(device), y.to(device)
    model = GPT(len(chars), a.context, a.dim, a.heads, a.layers).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=a.learning_rate)
    @torch.no_grad()
    def evaluate():
        model.eval(); result = {}
        for name, source in (('train', train_data), ('val', val_data)):
            vals = []
            for _ in range(10):
                xb, yb = batch(source); _, loss = model(xb, yb); vals.append(loss.item())
            result[name] = sum(vals)/len(vals)
        model.train(); return result
    for step in range(a.steps):
        x, y = batch(train_data); _, loss = model(x, y)
        optimizer.zero_grad(set_to_none=True); loss.backward(); optimizer.step()
        if step % a.eval_interval == 0 or step == a.steps-1:
            scores = evaluate()
            print(f"step {step:>5} | train loss {scores['train']:.4f} | val loss {scores['val']:.4f}")
    start = stoi.get('\n', 0)
    generated = torch.tensor([[start]], dtype=torch.long, device=device)
    model.eval()
    with torch.no_grad():
        for _ in range(a.sample_tokens):
            logits, _ = model(generated[:, -a.context:])
            probs = F.softmax(logits[:, -1, :], dim=-1)
            generated = torch.cat((generated, torch.multinomial(probs, 1)), dim=1)
    sample = ''.join(itos[i] for i in generated[0].tolist())
    print('\n--- Generated sample ---\n'); print(sample)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({'model_state_dict': model.state_dict(), 'stoi': stoi, 'itos': itos,
                'config': {'vocab_size':len(chars),'context':a.context,'dim':a.dim,'heads':a.heads,'layers':a.layers}}, a.out)
    print(f'\nCheckpoint saved to: {a.out}')

if __name__ == '__main__': main()
