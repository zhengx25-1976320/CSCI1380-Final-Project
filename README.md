# Project Gutenberg Open Books Search Engine

A title/author search engine built on a custom JavaScript MapReduce framework.
A coordinator sends HTTP-based RPC calls to five workers. Workers hash-partition
keys and store inputs, intermediate records, and the final index on disk.

## Run locally

Use Node.js 24 or newer and npm. From the project root:

```bash
npm ci
npm run preprocess
npm start
```

Open http://localhost:3000. Preprocessing runs crawling, indexing, and dictionary
generation in order, with one coordinator on port 7070 and five workers on ports
7110–7114. It shuts down its workers when done. The server starts those workers
again and reuses their persisted index. Press Ctrl+C to stop the server and its
local workers. Do not run the local server and local preprocessing concurrently.

The default crawl seed is a small Gutenberg directory. Override it if needed:

```bash
CRAWL_URL=https://atlas.cs.brown.edu/data/gutenberg/1/1/1/ npm run preprocess
```

Crawling requires reachable directory listings and plain-text books with
`Title:`, `Author:`, and `Language:` headers. The project indexes metadata,
not the full book text. A fetch failure fails the job rather than silently
publishing an incomplete corpus.

Preprocessing reuses an existing index and refreshes its spelling dictionary.
If it finds book metadata from a completed crawl, it continues with indexing.
It refuses incomplete/mixed data and preserves it. For a separate corpus, choose a
new `STORE_DIR` and use that same directory when starting the server:

```bash
STORE_DIR=/tmp/gutenberg-demo DICTIONARY_PATH=/tmp/gutenberg-demo/dictionary.txt npm run preprocess
STORE_DIR=/tmp/gutenberg-demo DICTIONARY_PATH=/tmp/gutenberg-demo/dictionary.txt npm start
```

If a port is occupied, stop the process that owns it or choose `RPC_PORT` and
`WORKER_BASE_PORT`. Keep the worker addresses/ports fixed between preprocessing
and serving: they form the workers' identities and determine key placement.

## Docker Compose

Install Docker with Compose, then run:

```bash
docker compose build
docker compose up -d worker-0 worker-1 worker-2 worker-3 worker-4
docker compose run --rm --no-deps web node workflows/preprocess.js
docker compose up -d web
```

Open http://localhost:3000. Each worker has its own named volume; a coordinator
volume holds the spelling dictionary. Containers communicate using worker
service names, and the browser uses a relative `/search` URL.

```bash
docker compose logs -f web
docker compose down
```

`down` preserves the volumes. Rerunning preprocessing reuses an existing index.
Do not add `--volumes` unless you intend to delete your persisted data.

## Kubernetes

The manifests in `k8s/` define:

- A five-replica worker StatefulSet (`worker-0` through `worker-4`).
- A headless Service providing stable names such as `worker-0.workers`.
- A 5 GiB ReadWriteOnce persistent volume claim for each worker.
- A single web coordinator, a ClusterIP Service, and a dictionary PVC.
- HTTP startup, readiness, and liveness probes.
- A one-time preprocessing Job, applied separately.

You need a cluster, kubectl, and a default StorageClass that can provision the
PVCs (or pre-provisioned matching volumes). The manifests initially scale the
web coordinator to zero so preprocessing can use its PVC without competing
with the server.

For a local kind cluster, first open Docker Desktop and wait for its engine to
start. Install kind if needed (`brew install kind`); Docker Desktop already
provides kubectl on a typical Mac installation. Create the cluster once:

```bash
kind create cluster --name gutenberg
kubectl config use-context kind-gutenberg
```

Then build and deploy from the project root:

```bash
docker build -t gutenberg-search:local .
kind load docker-image gutenberg-search:local --name gutenberg
kubectl apply -k k8s
kubectl -n gutenberg rollout status statefulset/worker --timeout=300s
kubectl apply -f k8s/preprocess-job.yaml
kubectl -n gutenberg logs -f job/preprocess
kubectl -n gutenberg wait --for=condition=complete job/preprocess --timeout=1800s
kubectl -n gutenberg scale deployment/web --replicas=1
kubectl -n gutenberg rollout status deployment/web --timeout=300s
kubectl -n gutenberg port-forward service/web 3000:3000
```

Open http://localhost:3000 while port forwarding runs. For a registry-backed
cluster, build/push an image tag that your cluster can pull, update `images` in
`k8s/kustomization.yaml`, and set the same image in `k8s/preprocess-job.yaml`.
Set a StorageClass explicitly if your cluster has no default. Applying the
base kustomization again resets the web replica count to zero; change its
`replicas` override to one after initial preprocessing for subsequent rollouts.

Inspect health and storage:

```bash
kubectl -n gutenberg get pods,pvc
kubectl -n gutenberg describe pod worker-0
kubectl -n gutenberg logs deployment/web
```

Worker `/healthz` checks the HTTP event loop; `/readyz` additionally checks disk
access. Web `/healthz` stays independent of backend availability. Web `/readyz`
checks all five workers, refreshes their in-memory group membership after
restarts, and verifies that a stored index entry exists. It returns 503 before
preprocessing completes or while any worker is unavailable.

Completed index data persists across Pod replacement because worker identity
uses StatefulSet DNS names instead of changing Pod IPs, and each worker mounts
its own retained PVC. Keep the five-worker membership fixed for this deployment.
This is partitioned storage, not replicated storage. Jobs are not transactional
or automatically resumable after a crash during input consumption/reduction;
use fresh volumes to rebuild a failed preprocessing run. Run only one
preprocessing coordinator against a worker group at a time.

RPC can deserialize executable functions and is intended for a trusted internal
network. Only the web HTTP port should be exposed to users; do not expose worker
RPC ports publicly.

## How the code fits together

```text
Browser -> Express /search -> hash-routed store lookup -> worker disk -> results

Preprocessing coordinator
  -> HTTP RPC: map on workers holding input keys
  -> disk-backed per-job map directories
  -> HTTP RPC: shuffle by emitted-key hash
  -> disk-backed per-job grouped intermediate directories
  -> HTTP RPC: reduce and publish crawler data / index
  -> delete per-job intermediate storage and temporary RPC services
```

- `distribution/all/mr.js`: phased execution, error propagation, shuffle, cleanup.
- `distribution/local/comm.js` and `node.js`: HTTP RPC client/server.
- `distribution/all/store.js`: hash-based placement and storage reconfiguration.
- `distribution/local/store.js`: encoded key filenames and atomic file replacement.
- `workflows/cluster.js`: local spawning or remote worker discovery and lifecycle.
- `workflows/crawler.js`: directory traversal and metadata extraction.
- `workflows/index.js`: unigram/bigram inverted index with TF-IDF scores.
- `workflows/server.js`: title/author queries, ranking, readiness, and shutdown.

Mapped inputs remain intact until every worker completes shuffle. Job-specific
intermediate directories avoid mixing values from different executions. Mapping
and reducing await async functions, handle empty outputs, and return RPC errors.
The crawler keeps grouped values for its next traversal; indexing publishes
reduced values. Original workflow inputs are consumed when output is published.

## Validation

```bash
npm run lint
npm test
npm run test:integration
```

The integration test starts five workers with temporary storage and a local
HTTP book fixture. It exercises crawling, indexing, title/author search,
spelling, repeated preprocessing, legacy filenames, empty jobs, mapper failure, intermediate cleanup, and persisted
search after a worker restart. It uses ports 17070, 17071, 17110–17114 and 3001.
The older Jest tests use their original ports; stop conflicting processes first.

The Kubernetes manifests follow the official [StatefulSet documentation](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
and [probe documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/).
The repository includes deployment configuration; a successful local test is
not evidence that it has been deployed to a Kubernetes cluster.
