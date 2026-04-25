---
title: On the Scalability of Transformer Attention
author: A. N. Other
date: 2026-04
---

# On the Scalability of Transformer Attention

## Abstract

Self-attention scales quadratically with sequence length, which is the central obstacle to long-context modeling. We survey three classes of mitigations --- sparse patterns, low-rank approximations, and kernel-based linear attention --- and argue that their reported gains are highly task-dependent.

## Introduction

The dot-product attention operator of Vaswani et al. takes $O(n^2 d)$ time for a sequence of length $n$ and head dimension $d$. This cost dominates training budgets for context windows beyond about sixteen thousand tokens, and is the reason most production systems still truncate or chunk their inputs.

Recent work claims that linear-time attention variants close this gap with negligible loss of quality. In practice we find that the picture is considerably more mixed: on retrieval-heavy tasks the gap remains large, while on summarization it is often within noise.

## Methods

We reimplement three baselines --- dense attention, a block-sparse variant, and a kernelized linear form --- and evaluate them on four long-context benchmarks. All models share the same seven-layer backbone and were trained to within one percent of their reported perplexity before measurement.

## Results

On passkey retrieval, the linear variant underperforms dense by a wide margin: its recall drops to chance at sequence lengths above thirty thousand. On summarization, by contrast, it is indistinguishable from dense within our measurement noise. The block-sparse variant tracks dense on both tasks while using roughly half the attention FLOPs, which is the strongest result in our sweep.

## Discussion

These results suggest that the community's reported wins for linear attention are driven by benchmarks that do not stress long-range retrieval. A more balanced evaluation would weight retrieval-heavy tasks more heavily than is currently standard.

## Conclusion

Attention is a bottleneck, but not a uniform one. The right mitigation depends on the task, and the field would benefit from benchmarks that make this dependence visible rather than averaging it away.
