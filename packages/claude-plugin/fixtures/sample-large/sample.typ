#set document(
  title: "The Scalability of Transformer Attention: A Critical Survey of Long-Context Mechanisms",
  author: "A. N. Other",
)
#set page(paper: "a4", margin: 1in)
#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true)
#set heading(numbering: "1.")

#align(center)[
  #text(size: 16pt, weight: "bold")[
    The Scalability of Transformer Attention: \
    A Critical Survey of Long-Context Mechanisms
  ]

  A. N. Other --- June 2026
]

#align(center)[
  #set par(justify: true)
  #box(width: 85%)[
    #set text(size: 10pt)
    *Abstract.* Self-attention scales quadratically with sequence length, and that
    single fact has shaped a decade of architecture research. A large literature now
    offers sub-quadratic alternatives --- sparse patterns, low-rank projections,
    kernel-based linear attention, recurrent state-space models, and
    retrieval-augmented hybrids --- each reporting favourable accuracy-versus-cost
    trade-offs. This survey argues that the reported gains are far more task-dependent
    than the headline numbers suggest, and that the field's evaluation conventions
    systematically flatter mechanisms which struggle on long-range retrieval. We give
    a unified complexity account of the major families, reimplement representative
    members of each under a shared training budget, and evaluate them on a battery of
    benchmarks chosen to separate genuine long-range reasoning from surface-level
    fluency. The block-sparse variant emerges as the most robust efficiency win in our
    sweep; the linear-attention family, by contrast, retains a large gap on
    retrieval-heavy tasks even when matched on perplexity. We close with concrete
    recommendations for evaluation design.
  ]
]

#outline(indent: auto)

= Introduction <introduction>

The dot-product attention operator of Vaswani et al. @vaswani2017attention computes,
for a sequence of length $n$ and head dimension $d$, an $n times n$ matrix of pairwise
scores. The cost is $O(n^2 d)$ in time and $O(n^2)$ in memory for the materialised
score matrix. For the context windows of early models --- five hundred to two thousand
tokens --- this cost was a rounding error against the feed-forward layers. At the
context lengths now demanded of production systems, it dominates both the training
budget and the inference latency, and it is the reason most deployed pipelines still
truncate, chunk, or summarise their inputs rather than attending over them directly.

A decade of work has responded with sub-quadratic alternatives. The proposals fall
into a handful of families: restrict the attention pattern to a sparse subset of
positions; approximate the score matrix with a low-rank factorisation; replace the
softmax with a kernel feature map that admits a linear-time recurrence; abandon
attention for an explicit recurrent state; or keep dense attention over a short window
and delegate long-range dependence to a retrieval index. Each family reports favourable
trade-offs, and each has been adopted somewhere in the production landscape.

This survey makes three claims. First, the families are more closely related than their
separate literatures suggest: most can be read as different answers to a single
question about which entries of the score matrix may be discarded, and a unified
complexity account makes the trade-offs comparable. Second, the reported accuracy gains
are highly task-dependent, and the dependence is not random --- it tracks whether the
task requires precise long-range retrieval or merely long-range _fluency_. Third, the
field's evaluation conventions, which average over heterogeneous benchmarks and weight
perplexity heavily, systematically favour mechanisms that are weak at retrieval. We
support these claims with a controlled reimplementation study and close with
recommendations for evaluation design.

We restrict our scope to mechanisms for the attention operator itself. We do not survey
quantisation, distillation, mixture-of-experts routing, or speculative decoding; these
are orthogonal efficiency levers that compose with any attention variant. Nor do we
treat the positional-encoding literature except where a scheme interacts directly with
a sparsity pattern.

= Background and Notation <background>

Fix a sequence of $n$ token representations $X in RR^(n times d_"model")$. A single
attention head projects $X$ into queries, keys, and values through learned matrices
$W_Q, W_K, W_V in RR^(d_"model" times d)$, giving $Q = X W_Q$, $K = X W_K$, and
$V = X W_V$. Scaled dot-product attention then computes

$ "Attn"(Q, K, V) = "softmax"((Q K^top) / sqrt(d)) V, $

where the softmax is applied row-wise. The product $Q K^top$ is the $n times n$ matrix
of scores whose materialisation costs $O(n^2 d)$ time and $O(n^2)$ memory; the
subsequent multiply by $V$ costs a further $O(n^2 d)$.

Multi-head attention runs $h$ such heads in parallel on $d = d_"model" \/ h$-dimensional
projections and concatenates the results. Throughout we use $n$ for sequence length, $d$
for per-head dimension, $h$ for the head count, and $L$ for the number of layers. We
report cost in terms of these symbols and treat $d$, $h$, and $L$ as constants when
characterising the asymptotic dependence on $n$, since it is the dependence on $n$ that
the long-context literature seeks to reduce.

Two distinctions structure the rest of the survey. The first is between _training-time_
and _inference-time_ cost. At training time the whole sequence is present and the
quadratic memory of the score matrix is the binding constraint. At inference time,
autoregressive decoding attends a growing key-value cache, and the binding constraint
is the linear-in-$n$ memory of that cache and the per-step cost of reading it. A
mechanism can help one regime and not the other. The second distinction is between
mechanisms that change the _result_ of attention --- approximations that compute
something other than the exact softmax --- and mechanisms that change only the
_schedule_, computing the exact result with a better memory-access pattern. We treat
the latter, exemplified by fused kernels, separately in @hardware, because they are not
in tension with accuracy at all.

= A Taxonomy of Sub-Quadratic Attention <taxonomy>

We organise the approximation literature by the structural assumption each family
places on the score matrix $S = Q K^top$.

*Sparse attention* assumes that $S$ is well-approximated by a matrix supported on a
fixed or data-dependent sparse set of positions. Each query attends only to a chosen
subset of keys, reducing the cost to $O(n k d)$ for $k$ attended keys per query. The
subset may be a fixed geometric pattern --- a local window, dilated strides, a handful
of global tokens --- or it may be chosen per input by hashing or clustering keys so that
a query meets only the keys likely to score highly.

*Low-rank attention* assumes that $S$, or the attention matrix after softmax, has low
effective rank, so that it can be reconstructed from a small number of landmark rows and
columns. Projecting keys and values down to $r << n$ landmarks gives an $O(n r d)$
operator. The assumption is that the row space of the attention matrix is genuinely
low-dimensional, which holds for some sequence distributions and fails for others.

*Kernel-based linear attention* replaces $exp(q dot k)$ with a kernel
$phi(q) dot phi(k)$ for an explicit feature map $phi$. Because the kernel factorises,
the operator can be rewritten to multiply keys and values _before_ contracting with
queries, yielding $O(n d^2)$ time and an $O(d^2)$ recurrent state independent of $n$.
The assumption is that a finite feature map reproduces the softmax kernel closely
enough; in practice $phi$ is chosen for tractability rather than fidelity, and the gap
between $phi(q) dot phi(k)$ and $exp(q dot k)$ is where accuracy is lost.

*State-space and recurrent models* abandon the score matrix entirely, propagating
information through a linear recurrence whose parameters are made input-dependent. These
models attain $O(n)$ time and constant per-step state, and recent variants are
competitive with attention on language modelling. They are not approximations of
attention --- they compute a different function --- but they occupy the same design slot
and we include them for completeness.

*Retrieval-augmented hybrids* keep exact dense attention over a short local window and
offload long-range dependence to an external index queried by the current state. The
asymptotic cost is that of the local window plus the retrieval, and the long-range
capability is bounded by the index's recall rather than by any property of the score
matrix.

These families are not mutually exclusive; production systems routinely combine a local
window with a few global tokens and a retrieval fallback. The taxonomy is a lens on the
assumptions, not a partition of the systems.

= Complexity Accounting <complexity>

@tab-complexity summarises the asymptotic cost of one attention layer for each family,
separating training-time score-matrix memory from inference-time state. The figures
assume a single head; multiply by $h$ for multi-head, and by $L$ for the full stack.

#figure(
  table(
    columns: 4,
    align: (left, center, center, center),
    table.header([Family], [Time], [Train memory], [Inference state]),
    [Dense softmax], [$O(n^2 d)$], [$O(n^2)$], [$O(n d)$],
    [Sparse ($k$ keys)], [$O(n k d)$], [$O(n k)$], [$O(n d)$],
    [Low-rank ($r$)], [$O(n r d)$], [$O(n r)$], [$O(r d)$],
    [Kernel linear], [$O(n d^2)$], [$O(d^2)$], [$O(d^2)$],
    [State-space], [$O(n d^2)$], [$O(d^2)$], [$O(d^2)$],
  ),
  caption: [
    Asymptotic cost of one attention layer by family. The inference-state column is the
    size of the per-step cache an autoregressive decoder must carry; it is the column
    that most directly governs the long-context serving cost.
  ],
) <tab-complexity>

Two observations follow that the headline "linear attention" framing obscures. First,
the families that achieve a constant inference state --- kernel linear and state-space
--- do so by compressing the entire history into a fixed-size summary. That compression
is exactly what makes them fast and exactly what limits their retrieval ability: a
fixed-size state cannot losslessly represent an unbounded history, so old information
must be overwritten. Sparse and low-rank attention, which keep an $O(n d)$ or $O(r d)$
cache, preserve more of the history and pay for it linearly. The constant-state property
is therefore not a free lunch; it is a particular point on a memory-fidelity trade-off,
and where a task falls on that trade-off determines whether the mechanism helps.

Second, the asymptotic constants matter at realistic lengths. A kernel-linear layer with
$O(n d^2)$ cost only beats dense $O(n^2 d)$ once $n > d$; for the head dimensions and
sequence lengths of many deployed models the crossover sits well inside the operating
range, but not so far below it that the constants are negligible. We report wall-clock
alongside asymptotics in @results precisely because the asymptotics alone mislead at the
lengths that matter.

= Sparse Attention <sparse>

Sparse attention is the oldest and, we will argue, the most reliable of the efficiency
families. The design question is which keys each query may see, and the answers divide
into fixed and data-dependent patterns.

Fixed patterns combine a local window, which captures the short-range dependence that
dominates natural language, with a sparse long-range component: dilated strides that let
information propagate across the sequence in a logarithmic number of hops, and a small
set of global tokens that every position can read and write. The combination is
attractive because it is static --- the sparsity pattern is known at compile time, so
the kernel can be specialised and the irregular memory access amortised. Its weakness is
that the pattern is chosen without reference to the input, so any long-range dependence
that does not align with the stride structure is invisible to the model.

Data-dependent patterns choose the attended set per input. One approach hashes queries
and keys into buckets so that vectors with high dot product land together, then attends
only within a bucket; another clusters keys and routes each query to its nearest
cluster. These methods recover long-range dependence that fixed patterns miss, at the
cost of a sorting or clustering step whose irregular control flow is harder to make
efficient on current accelerators. The accuracy is generally better than fixed patterns
on retrieval-heavy tasks and the throughput generally worse.

The block-sparse variant we evaluate sits between these poles: a fixed local window plus
a fixed set of global tokens, with attention computed in dense blocks so that the
sparsity is structured rather than element-wise. Structured sparsity is the key to its
efficiency --- a block-sparse multiply maps onto the dense matrix-multiply units of the
accelerator with little waste, whereas element-wise sparsity does not. This is the
mechanism that, in our experiments, tracks dense accuracy most closely while roughly
halving the attention FLOPs.

= Low-Rank and Kernel Methods <lowrank>

Low-rank and kernel methods share an assumption of compressibility but locate it
differently. Low-rank methods assume the attention matrix has few significant singular
values and reconstruct it from landmarks. The assumption is empirically reasonable for
inputs with strong global structure --- a document with a few dominant topics --- and
poor for inputs whose relevant dependencies are diffuse, such as code, where a variable
defined once may be used anywhere. When the assumption fails, the landmarks miss the
relevant interaction and the error is silent: the model produces a fluent but wrong
continuation rather than an obvious failure.

Kernel methods replace the softmax with a feature map $phi$ such that
$phi(q) dot phi(k) approx exp(q dot k \/ sqrt(d))$. The appeal is the associativity
rewrite: computing $phi(K)^top V$ first yields a $d times d$ summary that each query
then reads, giving linear time and a constant-size recurrent state. The difficulty is
that no finite, cheap $phi$ reproduces the exponential kernel faithfully across the whole
input domain; the maps used in practice --- elementwise nonlinearities, random features
--- are chosen for cost and trade fidelity for it. The fidelity gap is concentrated
exactly where the softmax is most peaked, that is, where a query has one strongly
matching key, which is precisely the retrieval case. This is the mechanistic reason, we
argue, that linear attention underperforms on retrieval while remaining competitive on
tasks that need only diffuse long-range context.

A subtlety often elided is normalisation. The softmax normalises each row to sum to one;
a kernel approximation must reproduce this denominator, and the standard trick of
dividing by $phi(q) dot sum_k phi(k)$ is itself an approximation that degrades as the
feature map's positivity assumptions are stressed. It is sometimes claimed that linear
attention is equivalent to softmax attention in the limit of an exact feature map. This
is true only in a limit that no deployed feature map approaches, and stating the
equivalence without that qualification overstates the case; the practically relevant
question is the size of the gap at the feature maps actually used, which our experiments
measure directly.

= State-Space and Recurrent Alternatives <ssm>

A distinct line of work returns to recurrence. Modern state-space models parameterise a
linear recurrence whose transition is input-dependent, recovering much of attention's
content-selectivity while retaining the constant per-step state of an RNN. On
language-modelling perplexity these models are now competitive with attention at matched
parameter counts, and their constant-state inference makes them attractive for
long-context serving.

We include them because they occupy attention's design slot, but we flag a measurement
hazard. State-space models are most often reported on perplexity and on synthetic recall
tasks of modest length. Perplexity rewards diffuse fluency, which these models do well;
their behaviour on the precise, long-range retrieval our benchmarks stress is less
thoroughly characterised, and the few controlled comparisons suggest the same retrieval
gap that afflicts kernel attention, for the same underlying reason --- a fixed-size state
cannot index an unbounded past. We treat them as a promising but not yet settled point
in the design space, and we evaluate one representative member alongside the attention
variants rather than asserting a verdict from the literature.

= Retrieval-Augmented Long Context <retrieval>

The retrieval-augmented approach declines to make the attention operator itself cheaper
and instead bounds the sequence the operator sees. A short local window is attended
densely; long-range dependence is served by an external index that the model queries and
whose results are spliced into the context. The asymptotic attention cost is then
independent of the nominal context length, and the long-range capability is whatever the
retriever's recall provides.

This relocates the scalability problem rather than solving it, which is a feature:
retrieval recall is a well-studied quantity with its own mature tooling, and decoupling
it from the attention mechanism lets each be optimised separately. The cost is a pipeline
whose long-range behaviour is only as good as the retriever and whose failures are
retrieval failures --- a relevant passage not returned is simply absent from the context,
with no gradient signal to recover it. For tasks whose long-range structure is genuinely
retrieval-shaped, such as open-book question answering, the approach is strong; for tasks
requiring integration over the whole input, such as global summarisation or whole-program
analysis, splicing a few retrieved passages is a poor substitute for attending over
everything.

= Hardware-Aware Exact Attention <hardware>

A separate strand of work leaves the attention function unchanged and attacks only its
memory-access schedule. The observation is that the quadratic memory cost of dense
attention is the cost of _materialising_ the score matrix in slow memory; if the
computation is tiled so that scores are produced, softmaxed, and consumed entirely within
fast on-chip memory, the score matrix is never written out and the memory cost falls to
linear while the result is bit-for-bit the exact softmax.

We stress that these methods are not approximations and are not in tension with accuracy
at all; they are a strictly better way to compute the same function, and they compose
with every approximation in this survey. Their existence reframes the efficiency
question. Once exact attention can be computed with linear memory and a wall-clock that
is a small multiple of an approximate method's, the burden on an approximation rises: it
must justify its accuracy cost against a dense baseline that is itself far cheaper than
the naive $O(n^2)$ memory figure suggests. Several efficiency claims in the literature
were calibrated against the naive baseline and shrink considerably when the comparison is
against a fused exact kernel. We use a fused exact kernel as our dense baseline
throughout, and we recommend the field do the same.

= Experimental Setup <setup>

We reimplement one representative member of each family: a fused exact kernel (dense), a
block-sparse variant with a local window and global tokens, a kernel-linear form with a
random-feature map, and one input-dependent state-space model. All models share a
seven-layer backbone with identical width, head count, vocabulary, and tokeniser, so that
only the attention mechanism varies. Each was trained on the same corpus under a fixed
compute budget and, before any measurement, trained to within one percent of its
reported perplexity on a held-out validation set, so that no model is handicapped by
under-training.

We evaluate on four benchmarks chosen to span the retrieval-versus-fluency axis. _Passkey
retrieval_ hides a short key at a random position in a long distractor context and asks
the model to reproduce it; it is a clean probe of precise long-range recall. _Long-document
summarisation_ asks for an abstractive summary of a multi-thousand-token document; it
requires long-range integration but tolerates imprecision in any single span. _Multi-hop
question answering_ requires chaining several facts scattered through the context.
_Variable-tracking_, a code-flavoured synthetic task, asks the model to report the final
value of a variable after a long sequence of assignments, stressing precise long-range
dependence of the kind low-rank methods handle poorly.

We report task accuracy and, separately, wall-clock throughput at a fixed sequence
length, so that an accuracy gain bought with a throughput loss is visible as such rather
than hidden behind an asymptotic label.

= Results <results>

On passkey retrieval the picture is stark. The kernel-linear variant's recall is strong
at short contexts and degrades to chance as the sequence grows past roughly thirty
thousand tokens: the fixed-size state cannot preserve a single arbitrary key against a
growing tide of distractors. The state-space model degrades along a similar curve for the
same reason. The block-sparse variant, whose global tokens give every position a durable
channel, holds recall close to dense across the full range. Low-rank attention is
intermediate, holding while the key happens to align with a retained landmark and failing
when it does not, which produces a high-variance recall curve.

On long-document summarisation the ranking collapses. All four variants are within
measurement noise of dense, including the two that failed passkey retrieval. This is the
central asymmetry of our results: summarisation rewards diffuse long-range fluency, which
every mechanism supplies, and does not stress the precise recall that separates them. A
field that weights summarisation-like benchmarks heavily will conclude that the efficient
variants are nearly free; a field that weights retrieval-like benchmarks will conclude
the opposite. Both conclusions are correct about their benchmarks and wrong as general
claims.

Multi-hop question answering and variable-tracking track passkey retrieval rather than
summarisation: the block-sparse variant stays near dense, the kernel-linear and
state-space variants fall off as the relevant span moves further from the query, and
low-rank attention is high-variance. On throughput, the kernel-linear and state-space
variants are the fastest at long context, as their asymptotics promise; the block-sparse
variant uses roughly half the attention FLOPs of dense while staying within a small
constant of dense throughput, which is the trade-off we judge most favourable across the
benchmark suite as a whole.

= Discussion <discussion>

The results admit a simple summary: the efficiency families differ not in how much
accuracy they cost on average but in _which_ capability they cost. Mechanisms that
compress the history into a fixed-size state --- kernel-linear and state-space --- trade
away precise long-range retrieval while preserving diffuse fluency. Mechanisms that keep
a per-position cache --- sparse and, partially, low-rank --- preserve retrieval and pay a
linear memory cost. There is no mechanism in our sweep that is uniformly best; there is a
trade-off, and the right choice is the one whose sacrificed capability the target task
does not need.

This reframes the community's reported wins for linear-time attention. Those wins are
real, but they are wins on benchmarks --- perplexity, summarisation --- that do not stress
long-range retrieval, and they are reported as general gains. A more balanced evaluation
would weight retrieval-heavy tasks more heavily than is currently standard, so that the
trade-off is visible in the headline number rather than buried in an appendix. The
hardware-aware exact kernels sharpen the point further: with a fused dense baseline far
cheaper than the naive one, many approximations no longer pay for themselves on tasks
where their accuracy cost is real.

We do not read this as a verdict against efficient attention. We read it as an argument
for task-aware deployment and benchmark-aware reporting. For a summarisation service,
kernel-linear attention may be the correct engineering choice; for a code-analysis tool,
block-sparse or dense-with-retrieval will serve far better; and a single averaged
leaderboard number cannot express that distinction.

= Threats to Validity <threats>

Several caveats bound our conclusions. Our backbone is fixed at seven layers and a single
width; the trade-offs may shift at the scale of frontier models, where the relative cost
of attention against the feed-forward layers changes. We reimplement one representative of
each family, and a different design point within a family --- a better feature map, a
learned sparsity pattern --- might move its curve; our claims are about the families as
represented, not about the best conceivable member of each. Our retrieval benchmarks are
partly synthetic, chosen for the clean signal they give about precise recall, and
synthetic tasks can both over- and under-state real-world behaviour. Finally, we matched
models on perplexity before measurement, which is itself a choice: matching on a different
axis, such as training FLOPs, would shift the comparison. We report these so the reader
can calibrate the strength of the conclusions, which we intend as well-supported for the
regime studied and as hypotheses beyond it.

= Related Work <related>

The efficient-attention literature is large and we have cited representatives rather than
attempting completeness. Surveys of the area have tended to organise mechanisms by their
algorithmic technique; our organising principle, the memory-fidelity trade-off, cuts
across those categories and is, we believe, more predictive of which tasks a mechanism
will serve. The evaluation critique we offer echoes a broader unease about leaderboard
averaging in the long-context literature, and complements work on long-context benchmark
design that has argued, as we do, that aggregate scores conceal capability-specific
failures. Our contribution relative to that work is the controlled, budget-matched
reimplementation that ties the evaluation critique to a mechanistic account of why the
failures occur.

= Conclusion <conclusion>

Attention is a bottleneck, but not a uniform one. A decade of sub-quadratic mechanisms
has produced genuine efficiency gains, but those gains are purchased with capability that
differs by family: the constant-state methods sacrifice precise long-range retrieval, the
per-position-cache methods preserve it at linear cost, and no single mechanism dominates.
The field's evaluation conventions, by averaging over heterogeneous benchmarks and
weighting fluency-shaped tasks heavily, have systematically flattered the methods that are
weakest at retrieval. The remedy is not a better mechanism but a better measurement:
report the trade-off, weight retrieval-heavy tasks in proportion to their difficulty, and
calibrate against a hardware-aware exact baseline. The right mitigation depends on the
task, and the field would benefit from benchmarks that make this dependence visible rather
than averaging it away.

#bibliography("references.bib", title: "References")
