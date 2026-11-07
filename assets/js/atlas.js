(() => {
  "use strict";

  const CONFIG = {
    apiBase: typeof window.ATLAS_API_BASE === "string"
      ? window.ATLAS_API_BASE.trim().replace(/\/+$/, "")
      : "",
    pageSize: 30,
    depth: 1,
    maxNodes: 120,
    maxEdges: 360,
    searchDelay: 350,
    staticUrl: "assets/data/atlas-public.enc.json",
    staticSchema: "npu-atlas-public-snapshot-encrypted/1",
  };

  const PUBLIC_STATUSES = new Set(["VERIFIED", "PENDING"]);

  const TYPE_LABELS = {
    researcher: "Researcher",
    publication: "Publication",
    topic: "Research topic",
    university: "University",
    faculty: "Faculty",
    technology: "Technology",
  };

  const PROFILE_PATHS = {
    researcher: "researchers",
    publication: "publications",
    topic: "topics",
  };

  const dom = {};
  let cy = null;
  let searchSeq = 0;
  let detailSeq = 0;
  let graphSeq = 0;
  let searchTimer = null;
  let selectedId = null;
  let staticMode = false;
  let staticData = null;
  let staticIndex = null;
  let eventsBound = false;

  function byData(name) {
    return document.querySelector(`[data-atlas-${name}]`);
  }

  function cacheDom() {
    dom.form = byData("form");
    dom.query = document.getElementById("atlas-query");
    dom.entity = document.getElementById("atlas-entity");
    dom.status = document.getElementById("atlas-status");
    dom.notice = byData("notice");
    dom.verified = byData("verified");
    dom.pending = byData("pending");
    dom.sources = byData("sources");
    dom.updated = byData("updated");
    dom.scopeStatus = byData("scope-status");
    dom.results = byData("results");
    dom.resultsEmpty = byData("results-empty");
    dom.count = byData("count");
    dom.graph = byData("graph");
    dom.graphEmpty = byData("graph-empty");
    dom.graphCount = byData("graph-count");
    dom.detail = byData("detail");
    dom.detailEmpty = byData("detail-empty");
    dom.detailStatus = byData("detail-status");
    dom.lock = byData("lock");
    dom.lockForm = byData("unlock-form");
    dom.password = byData("password");
    dom.lockStatus = byData("lock-status");
    dom.lockSubmit = byData("unlock-submit");
    dom.content = byData("content");
    dom.lockButton = byData("lock-button");
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setNotice(message) {
    if (!dom.notice) return;
    dom.notice.textContent = message;
    dom.notice.hidden = false;
  }

  function hideNotice() {
    if (dom.notice) dom.notice.hidden = true;
  }

  function setScopeStatus(message) {
    if (dom.scopeStatus) dom.scopeStatus.textContent = message;
  }

  function scopeLabel(scope) {
    if (!scope) return "";
    return scope.includes_pending ? "VERIFIED + PENDING (labeled)" : "VERIFIED only";
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || String(type || "Record");
  }

  function truncate(value, maxLength) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function statusBadge(status) {
    const name = String(status || "UNKNOWN");
    return element("span", `atlas-badge atlas-badge--${name.toLowerCase()}`, name);
  }

  function statusValues() {
    if (dom.status && dom.status.value === "verified") return ["VERIFIED"];
    if (dom.status && dom.status.value === "pending") return ["PENDING"];
    return ["VERIFIED", "PENDING"];
  }

  function withScope(params) {
    return { ...params, status: statusValues() };
  }

  function safeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function apiOriginValid(base) {
    try {
      const url = new URL(base);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function buildUrl(path, params) {
    const url = new URL(path, `${CONFIG.apiBase}/`);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null && entry !== "") {
            url.searchParams.append(key, String(entry));
          }
        });
      } else {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  async function api(path, params) {
    if (staticMode) return staticApi(path, params);
    const response = await fetch(buildUrl(path, params), {
      method: "GET",
      headers: { Accept: "application/json" },
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload && payload.detail;
      const message = typeof detail === "string"
        ? detail
        : (detail && detail.message) || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* ---------------------------------------------------------------------
   * Static snapshot mode
   *
   * GitHub Pages has no API server, so the default data source is a
   * same-origin JSON snapshot produced by scripts/export_public_snapshot.py.
   * The client mirrors the public API's search, profile, and bounded-graph
   * behaviour over the already-sanitized snapshot. Setting
   * window.ATLAS_API_BASE switches back to the live API.
   * ------------------------------------------------------------------- */

  function normalizeStatuses(value) {
    const raw = Array.isArray(value) ? value : (value ? [value] : []);
    if (!raw.length) return ["VERIFIED"];
    const unique = [];
    for (const status of raw) {
      if (!PUBLIC_STATUSES.has(status)) {
        throw new Error(`Unsupported public status: ${status}`);
      }
      if (!unique.includes(status)) unique.push(status);
    }
    return unique;
  }

  function staticScope(statuses) {
    return {
      access: "public-read-only",
      origin: "real",
      statuses,
      includes_pending: statuses.includes("PENDING"),
      includes_demo: false,
      policy: staticData && staticData.policy ? staticData.policy : "",
    };
  }

  function buildStaticIndex() {
    const nodesById = new Map();
    staticData.nodes.forEach((node) => nodesById.set(node.id, node));
    const edgesByNode = new Map();
    staticData.edges.forEach((edge) => {
      const pairs = [
        [edge.source_node_id, edge.target_node_id],
        [edge.target_node_id, edge.source_node_id],
      ];
      pairs.forEach(([from, to]) => {
        if (!edgesByNode.has(from)) edgesByNode.set(from, []);
        edgesByNode.get(from).push({ edge, otherId: to });
      });
    });
    staticIndex = { nodesById, edgesByNode };
  }

  function staticNode(id) {
    return staticIndex.nodesById.get(id);
  }

  function incidentEdges(id) {
    return staticIndex.edgesByNode.get(id) || [];
  }

  function outgoingEdges(id, type) {
    return incidentEdges(id)
      .filter(({ edge }) => edge.source_node_id === id && (!type || edge.type === type))
      .map(({ edge, otherId }) => ({ edge, node: staticNode(otherId) }))
      .filter(({ node }) => Boolean(node));
  }

  function incomingEdges(id, type) {
    return incidentEdges(id)
      .filter(({ edge }) => edge.target_node_id === id && (!type || edge.type === type))
      .map(({ edge, otherId }) => ({ edge, node: staticNode(otherId) }))
      .filter(({ node }) => Boolean(node));
  }

  function isPublicNode(node, statuses) {
    return Boolean(node) && node.is_demo !== true && statuses.includes(node.evidence_status);
  }

  function nodeSearchText(node) {
    return [node.name, node.description, node.external_id, JSON.stringify(node.metadata || {})]
      .join(" ")
      .toLowerCase();
  }

  function relatedSearchText(node) {
    const parts = [nodeSearchText(node)];
    incidentEdges(node.id).forEach(({ otherId }) => {
      const other = staticNode(otherId);
      if (other) parts.push(nodeSearchText(other));
    });
    return parts.join(" ");
  }

  function publicationYear(node) {
    const value = node && node.metadata ? node.metadata.year : null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function yearAllowed(node, yearFrom, yearTo) {
    if (node.type !== "publication") return true;
    if (yearFrom === null && yearTo === null) return true;
    const year = publicationYear(node);
    if (year === null) return false;
    if (yearFrom !== null && year < yearFrom) return false;
    if (yearTo !== null && year > yearTo) return false;
    return true;
  }

  function optionalYear(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function staticHealth() {
    const dataset = staticData.dataset || {};
    return {
      status: "ok",
      service: "NPU Research Atlas static public snapshot",
      schema_version: 1,
      real_nodes: dataset.nodes || staticData.nodes.length,
      verified_nodes: dataset.verified_nodes || 0,
      pending_nodes: dataset.pending_nodes || 0,
    };
  }

  function staticFacets(params) {
    const statuses = normalizeStatuses((params || {}).status);
    const nodes = staticData.nodes.filter((node) => isPublicNode(node, statuses));
    const topics = nodes
      .filter((node) => node.type === "topic")
      .map((node) => ({
        id: node.id,
        name: node.name,
        evidence_status: node.evidence_status,
        is_demo: false,
      }));
    const faculties = nodes
      .filter((node) => node.type === "faculty")
      .map((node) => ({ id: node.id, name: node.name }));
    const years = nodes
      .filter((node) => node.type === "publication" && publicationYear(node) !== null)
      .map(publicationYear);
    const counts = {};
    nodes.forEach((node) => {
      counts[node.type] = (counts[node.type] || 0) + 1;
    });
    return {
      topics,
      faculties,
      year_min: years.length ? Math.min(...years) : null,
      year_max: years.length ? Math.max(...years) : null,
      counts,
      statuses,
      origin: "real",
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticSearch(params) {
    const statuses = normalizeStatuses(params.status);
    const entity = params.entity_type || "researcher";
    if (!["researcher", "publication", "topic"].includes(entity)) {
      throw new Error(`Unsupported entity type: ${entity}`);
    }
    const query = String(params.q || "").trim().toLowerCase();
    const yearFrom = optionalYear(params.year_from);
    const yearTo = optionalYear(params.year_to);
    let nodes = staticData.nodes.filter(
      (node) => node.type === entity && isPublicNode(node, statuses)
    );
    if (query) {
      nodes = nodes.filter((node) => relatedSearchText(node).includes(query));
    }
    if (entity === "publication" && (yearFrom !== null || yearTo !== null)) {
      nodes = nodes.filter((node) => yearAllowed(node, yearFrom, yearTo));
    }
    nodes.sort((left, right) => {
      const byName = String(left.name || "").localeCompare(String(right.name || ""));
      return byName || String(left.id).localeCompare(String(right.id));
    });
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Number(params.page_size) || 20);
    const total = nodes.length;
    const items = nodes.slice((page - 1) * pageSize, page * pageSize).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      evidence_status: node.evidence_status,
      is_demo: false,
      external_id: node.external_id,
      source: node.source,
      matched_on: query ? ["Name / metadata"] : ["All matching records"],
      year: node.metadata ? node.metadata.year : null,
      doi: node.metadata ? node.metadata.doi : null,
      orcid: null,
      affiliation: null,
    }));
    return {
      items,
      total,
      page,
      page_size: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      query,
      entity_type: entity,
      filters: { statuses, origin: "real", year_from: yearFrom, year_to: yearTo },
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticResearcherProfile(id, statuses) {
    const node = staticNode(id);
    if (!node || node.type !== "researcher" || !isPublicNode(node, statuses)) {
      throw new Error("Profile not found.");
    }
    const facultyEntry = outgoingEdges(id, "belongs_to").find(
      ({ edge, node: faculty }) =>
        faculty.type === "faculty" &&
        isPublicNode(faculty, statuses) &&
        statuses.includes(edge.evidence_status)
    );
    const publications = outgoingEdges(id, "authored")
      .filter(
        ({ edge, node: publication }) =>
          publication.type === "publication" &&
          isPublicNode(publication, statuses) &&
          statuses.includes(edge.evidence_status)
      )
      .map(({ edge, node: publication }) => {
        const topics = outgoingEdges(publication.id, "discusses")
          .filter(
            ({ edge: topicEdge, node: topic }) =>
              topic.type === "topic" &&
              isPublicNode(topic, statuses) &&
              statuses.includes(topicEdge.evidence_status)
          )
          .map(({ node: topic }) => ({
            id: topic.id,
            name: topic.name,
            evidence_status: topic.evidence_status,
            provider_id: topic.metadata ? topic.metadata.provider_id : null,
          }));
        return {
          id: publication.id,
          name: publication.name,
          year: publication.metadata ? publication.metadata.year : null,
          doi: publication.metadata ? publication.metadata.doi : null,
          source_url: publication.metadata ? publication.metadata.source_url : null,
          venue: publication.metadata ? publication.metadata.venue : null,
          evidence_status: publication.evidence_status,
          is_demo: false,
          source: publication.source,
          author_position: edge.metadata ? edge.metadata.author_position : null,
          npu_affiliation_on_work: edge.metadata ? edge.metadata.npu_affiliation_on_work : null,
          school_affiliation_on_work: edge.metadata
            ? edge.metadata.school_affiliation_on_work
            : null,
          topics,
        };
      });
    const topicMap = new Map();
    publications.forEach((publication) => {
      publication.topics.forEach((topic) => {
        if (!topicMap.has(topic.id)) {
          topicMap.set(topic.id, { ...topic, supporting_publications: [] });
        }
        topicMap.get(topic.id).supporting_publications.push({
          id: publication.id,
          name: publication.name,
          year: publication.year,
          doi: publication.doi,
          source_url: publication.source_url,
          evidence_status: publication.evidence_status,
        });
      });
    });
    const topics = [...topicMap.values()].sort(
      (left, right) =>
        right.supporting_publications.length - left.supporting_publications.length ||
        String(left.name || "").localeCompare(String(right.name || ""))
    );
    const years = {};
    const counts = {};
    publications.forEach((publication) => {
      const year = Number(publication.year);
      if (Number.isFinite(year)) years[year] = (years[year] || 0) + 1;
      counts[publication.evidence_status] = (counts[publication.evidence_status] || 0) + 1;
    });
    return {
      profile_kind: "researcher",
      researcher: node,
      faculty: facultyEntry ? facultyEntry.node : null,
      publications,
      topics,
      publication_count: publications.length,
      topic_count: topics.length,
      publication_years: Object.fromEntries(
        Object.entries(years).sort((left, right) => Number(left[0]) - Number(right[0]))
      ),
      evidence_status_counts: counts,
      notes: [
        "Topics are derived from this researcher's authored publications and the publications' topic assignments.",
        "Shared topics do not establish collaboration; no collaboration relationship is implied by this profile.",
        "Publication evidence retains its own PENDING or VERIFIED state.",
      ],
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticPublicationProfile(id, statuses) {
    const node = staticNode(id);
    if (!node || node.type !== "publication" || !isPublicNode(node, statuses)) {
      throw new Error("Profile not found.");
    }
    const authors = incomingEdges(id, "authored")
      .filter(
        ({ edge, node: researcher }) =>
          researcher.type === "researcher" &&
          isPublicNode(researcher, statuses) &&
          statuses.includes(edge.evidence_status)
      )
      .map(({ edge, node: researcher }) => ({
        id: researcher.id,
        name: researcher.name,
        evidence_status: researcher.evidence_status,
        is_demo: false,
        source: researcher.source,
        author_position: edge.metadata ? edge.metadata.author_position : null,
        npu_affiliation_on_work: edge.metadata ? edge.metadata.npu_affiliation_on_work : null,
        school_affiliation_on_work: edge.metadata
          ? edge.metadata.school_affiliation_on_work
          : null,
      }));
    const topics = outgoingEdges(id, "discusses")
      .filter(
        ({ edge, node: topic }) =>
          topic.type === "topic" &&
          isPublicNode(topic, statuses) &&
          statuses.includes(edge.evidence_status)
      )
      .map(({ node: topic }) => ({
        id: topic.id,
        name: topic.name,
        evidence_status: topic.evidence_status,
        provider_id: topic.metadata ? topic.metadata.provider_id : null,
      }));
    const countByStatus = (items) => {
      const counts = {};
      items.forEach((item) => {
        counts[item.evidence_status] = (counts[item.evidence_status] || 0) + 1;
      });
      return counts;
    };
    return {
      profile_kind: "publication",
      publication: node,
      authors,
      topics,
      evidence_status_counts: {
        authors: countByStatus(authors),
        topics: countByStatus(topics),
      },
      notes: [
        "Author order and affiliation evidence are preserved from the authored relationships.",
        "Publication and topic assignments may be PENDING or VERIFIED independently.",
      ],
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticTopicProfile(id, statuses) {
    const node = staticNode(id);
    if (!node || node.type !== "topic" || !isPublicNode(node, statuses)) {
      throw new Error("Profile not found.");
    }
    const publications = incomingEdges(id, "discusses")
      .filter(
        ({ edge, node: publication }) =>
          publication.type === "publication" &&
          isPublicNode(publication, statuses) &&
          statuses.includes(edge.evidence_status)
      )
      .map(({ edge, node: publication }) => ({
        id: publication.id,
        name: publication.name,
        year: publication.metadata ? publication.metadata.year : null,
        doi: publication.metadata ? publication.metadata.doi : null,
        source_url: publication.metadata ? publication.metadata.source_url : null,
        evidence_status: publication.evidence_status,
        is_demo: false,
        source: publication.source,
        discusses_edge_id: edge.id,
        discusses_edge_status: edge.evidence_status,
      }));
    const researcherMap = new Map();
    publications.forEach((publication) => {
      incomingEdges(publication.id, "authored").forEach(({ edge, node: researcher }) => {
        if (
          researcher.type !== "researcher" ||
          !isPublicNode(researcher, statuses) ||
          !statuses.includes(edge.evidence_status)
        ) {
          return;
        }
        if (!researcherMap.has(researcher.id)) {
          researcherMap.set(researcher.id, {
            id: researcher.id,
            name: researcher.name,
            evidence_status: researcher.evidence_status,
            is_demo: false,
            source: researcher.source,
            supporting_publications: [],
          });
        }
        const entry = researcherMap.get(researcher.id);
        if (!entry.supporting_publications.some((item) => item.id === publication.id)) {
          entry.supporting_publications.push({
            id: publication.id,
            name: publication.name,
            year: publication.year,
            doi: publication.doi,
            source_url: publication.source_url,
            evidence_status: publication.evidence_status,
          });
        }
      });
    });
    const researchers = [...researcherMap.values()].sort(
      (left, right) =>
        right.supporting_publications.length - left.supporting_publications.length ||
        String(left.name || "").localeCompare(String(right.name || ""))
    );
    return {
      profile_kind: "topic",
      topic: node,
      supporting_publications: publications,
      associated_researchers: researchers,
      publication_count: publications.length,
      researcher_count: researchers.length,
      notes: [
        "Researchers are associated with this topic only because they authored publications that discuss the topic.",
        "This association is not evidence of collaboration between researchers.",
      ],
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticGraph(params) {
    const statuses = normalizeStatuses(params.status);
    const center = staticNode(params.center_id);
    if (!center || !isPublicNode(center, statuses)) {
      throw new Error("Profile not found.");
    }
    const depth = Math.min(3, Math.max(1, Number(params.depth) || 1));
    const maxNodes = Math.min(300, Math.max(1, Number(params.max_nodes) || 120));
    const maxEdges = Math.min(900, Math.max(1, Number(params.max_edges) || 360));
    const nodeTypes = params.type
      ? new Set(Array.isArray(params.type) ? params.type : [params.type])
      : null;
    const edgeTypes = params.edge_type
      ? new Set(Array.isArray(params.edge_type) ? params.edge_type : [params.edge_type])
      : null;
    const yearFrom = optionalYear(params.year_from);
    const yearTo = optionalYear(params.year_to);

    const allowedIds = new Set([center.id]);
    const allowedEdges = new Map();
    let frontier = [center.id];
    for (let level = 0; level < depth; level += 1) {
      const next = [];
      frontier.forEach((id) => {
        incidentEdges(id).forEach(({ edge, otherId }) => {
          if (!statuses.includes(edge.evidence_status)) return;
          if (edgeTypes && !edgeTypes.has(edge.type)) return;
          const other = staticNode(otherId);
          if (!other || !isPublicNode(other, statuses)) return;
          if (nodeTypes && !nodeTypes.has(other.type)) return;
          if (!yearAllowed(other, yearFrom, yearTo)) return;
          if (!allowedIds.has(otherId) && allowedIds.size >= maxNodes) return;
          allowedIds.add(otherId);
          allowedEdges.set(edge.id, edge);
          if (!next.includes(otherId)) next.push(otherId);
        });
      });
      frontier = next;
      if (allowedIds.size >= maxNodes) break;
    }

    const edges = [...allowedEdges.values()]
      .filter(
        (edge) => allowedIds.has(edge.source_node_id) && allowedIds.has(edge.target_node_id)
      )
      .slice(0, maxEdges);
    const nodes = [...allowedIds]
      .map((id) => staticNode(id))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.id === center.id) return -1;
        if (right.id === center.id) return 1;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });
    return {
      center: { id: center.id, name: center.name, type: center.type },
      nodes,
      edges,
      node_count: nodes.length,
      edge_count: edges.length,
      truncated: allowedIds.size >= maxNodes || edges.length >= maxEdges,
      filters: {
        statuses,
        origin: "real",
        depth,
        year_from: yearFrom,
        year_to: yearTo,
      },
      elapsed_ms: 0,
      public_scope: staticScope(statuses),
    };
  }

  function staticApi(path, params) {
    const options = params || {};
    if (path === "/api/public/dataset") return staticData.dataset;
    if (path === "/api/public/health") return staticHealth();
    if (path === "/api/public/facets") return staticFacets(options);
    if (path === "/api/public/search") return staticSearch(options);
    if (path === "/api/public/graph") return staticGraph(options);
    const profile = path.match(/^\/api\/public\/(researchers|publications|topics)\/(.+)$/);
    if (profile) {
      const id = decodeURIComponent(profile[2]);
      const statuses = normalizeStatuses(options.status);
      if (profile[1] === "researchers") return staticResearcherProfile(id, statuses);
      if (profile[1] === "publications") return staticPublicationProfile(id, statuses);
      return staticTopicProfile(id, statuses);
    }
    const neighbors = path.match(/^\/api\/public\/neighbors\/(.+)$/);
    if (neighbors) {
      return staticGraph({
        ...options,
        center_id: decodeURIComponent(neighbors[1]),
        depth: 1,
      });
    }
    throw new Error("Static snapshot does not provide this endpoint.");
  }

  function base64ToBytes(value) {
    const binary = window.atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function decryptSnapshot(password) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Password unlock requires HTTPS or localhost in a modern browser.");
    }
    const response = await fetch(CONFIG.staticUrl, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Encrypted snapshot request failed (${response.status}).`);
    }
    const envelope = await response.json();
    const kdf = envelope && envelope.kdf;
    const cipher = envelope && envelope.cipher;
    if (
      !envelope ||
      envelope.schema !== CONFIG.staticSchema ||
      !kdf ||
      kdf.name !== "PBKDF2" ||
      kdf.hash !== "SHA-256" ||
      !cipher ||
      cipher.name !== "AES-GCM"
    ) {
      throw new Error("Encrypted snapshot has an unsupported format.");
    }
    const iterations = Number(kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 100000) {
      throw new Error("Encrypted snapshot has invalid PBKDF2 parameters.");
    }
    const salt = base64ToBytes(kdf.salt);
    const iv = base64ToBytes(cipher.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plaintext = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(envelope.aad || ""),
        tagLength: Number(cipher.tagLength) || 128,
      },
      key,
      ciphertext
    );
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error("Decrypted snapshot is malformed.");
    }
    return data;
  }

  async function unlockStatic(password) {
    if (dom.lockSubmit) {
      dom.lockSubmit.disabled = true;
      dom.lockSubmit.textContent = "Unlocking…";
    }
    if (dom.lockForm) dom.lockForm.setAttribute("aria-busy", "true");
    if (dom.lockStatus) dom.lockStatus.textContent = "Unlocking…";
    try {
      const data = await decryptSnapshot(password);
      staticData = data;
      staticMode = true;
      buildStaticIndex();
      if (dom.password) dom.password.value = "";
      if (dom.lock) dom.lock.hidden = true;
      if (dom.content) dom.content.hidden = false;
      bindEvents();
      if (dom.lockStatus) dom.lockStatus.textContent = "";
      try {
        await loadDataset();
      } catch (error) {
        renderApiError(error);
      }
      await runSearch();
      return true;
    } catch (error) {
      staticData = null;
      staticMode = false;
      staticIndex = null;
      if (dom.lock) dom.lock.hidden = false;
      if (dom.content) dom.content.hidden = true;
      if (dom.password) {
        dom.password.value = "";
        dom.password.focus();
      }
      const wrongPassword =
        error && (error.name === "OperationError" || error.name === "DataError");
      if (dom.lockStatus) {
        dom.lockStatus.textContent = wrongPassword
          ? "Incorrect password. Try again."
          : `Could not unlock: ${error.message}`;
      }
      return false;
    } finally {
      if (dom.lockSubmit) {
        dom.lockSubmit.disabled = false;
        dom.lockSubmit.textContent = "Unlock Atlas";
      }
      if (dom.lockForm) dom.lockForm.setAttribute("aria-busy", "false");
    }
  }

  function bindUnlockForm() {
    if (!dom.lockForm || dom.lockForm.dataset.bound === "1") return;
    dom.lockForm.dataset.bound = "1";
    dom.lockForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const password = dom.password ? dom.password.value : "";
      if (!password) {
        if (dom.lockStatus) dom.lockStatus.textContent = "Enter the password.";
        return;
      }
      unlockStatic(password);
    });
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return new Intl.NumberFormat().format(number);
  }

  function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function displayValue(value) {
    if (value === undefined || value === null || value === "") return null;
    if (Array.isArray(value)) {
      return value.map(displayValue).filter(Boolean).join(", ") || null;
    }
    if (typeof value === "object") {
      if (typeof value.display_name === "string") return value.display_name;
      const entries = Object.entries(value)
        .map(([key, entry]) => {
          const shown = displayValue(entry);
          return shown ? `${key}: ${shown}` : null;
        })
        .filter(Boolean);
      return entries.join(", ") || null;
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function addFact(list, label, value, kind) {
    const shown = displayValue(value);
    if (!shown) return;
    const term = element("dt", null, label);
    const detail = element("dd");
    if (kind === "url") {
      const href = safeHttpUrl(shown);
      if (!href) return;
      const link = element("a", null, shown);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      detail.append(link);
    } else if (kind === "doi") {
      const href = safeHttpUrl(/^https?:\/\//i.test(shown) ? shown : `https://doi.org/${shown}`);
      if (href) {
        const link = element("a", null, shown);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        detail.append(link);
      } else {
        detail.textContent = shown;
      }
    } else {
      detail.textContent = shown;
    }
    list.append(term, detail);
  }

  function resetGraph(message) {
    graphSeq += 1;
    if (cy) {
      cy.destroy();
      cy = null;
    }
    if (dom.graph) dom.graph.hidden = true;
    if (dom.graphEmpty) {
      dom.graphEmpty.hidden = false;
      dom.graphEmpty.textContent = message;
    }
    if (dom.graphCount) dom.graphCount.textContent = "Select a result";
  }

  function clearDetail() {
    detailSeq += 1;
    if (dom.detail) dom.detail.replaceChildren();
    if (dom.detailEmpty) dom.detailEmpty.hidden = false;
    if (dom.detailStatus) dom.detailStatus.textContent = "—";
  }

  function disableControls() {
    if (!dom.form) return;
    dom.form.querySelectorAll("input, select, button").forEach((control) => {
      control.disabled = true;
    });
  }

  function renderUnavailable(message) {
    setNotice(message);
    setScopeStatus("Atlas data unavailable.");
    disableControls();
    if (dom.resultsEmpty) {
      dom.resultsEmpty.hidden = false;
      dom.resultsEmpty.textContent = "Atlas data could not be loaded.";
    }
    if (dom.count) dom.count.textContent = "—";
    resetGraph("The network view is unavailable until Atlas data loads.");
    clearDetail();
  }

  function renderNoticeForConfig(message) {
    setNotice(message);
    setScopeStatus("Atlas API unavailable: invalid endpoint configuration.");
    disableControls();
    if (dom.resultsEmpty) {
      dom.resultsEmpty.hidden = false;
      dom.resultsEmpty.textContent = "The configured Atlas API endpoint is invalid.";
    }
    if (dom.count) dom.count.textContent = "—";
    resetGraph("The network view is unavailable until the Atlas API endpoint is valid.");
    clearDetail();
  }

  function renderApiError(error) {
    const suffix = error && error.message ? ` ${error.message}` : "";
    const source = staticMode ? "static Atlas snapshot" : "public Atlas API";
    setNotice(`The ${source} could not be loaded.${suffix}`);
    setScopeStatus("Atlas data unavailable.");
  }

  async function loadDataset() {
    const dataset = await api("/api/public/dataset", {});
    if (dom.verified) dom.verified.textContent = formatNumber(dataset.verified_nodes);
    if (dom.pending) dom.pending.textContent = formatNumber(dataset.pending_nodes);
    if (dom.sources) dom.sources.textContent = formatNumber(dataset.sources);
    if (dom.updated) dom.updated.textContent = formatDate(dataset.updated_at) || "Not recorded";
    const generated = staticMode && staticData
      ? `Static snapshot generated ${formatDate(staticData.generated_at) || staticData.generated_at}. `
      : "";
    setScopeStatus(
      `${generated}${formatNumber(dataset.nodes)} real nodes. ` +
      "PENDING records are awaiting human review and are not verified findings."
    );
  }

  function renderResults(payload) {
    if (!dom.results) return;
    dom.results.replaceChildren();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (dom.count) {
      const total = formatNumber(payload.total) || "0";
      dom.count.textContent = `${total} result${payload.total === 1 ? "" : "s"} · ${scopeLabel(payload.public_scope)}`;
    }
    if (dom.resultsEmpty) dom.resultsEmpty.hidden = items.length > 0;

    const buttons = [];
    items.forEach((item) => {
      const button = element("button", "atlas-result");
      button.type = "button";
      button.dataset.nodeId = item.id;

      const top = element("span", "atlas-result__top");
      top.append(
        element("span", "atlas-result__title", item.name || "Untitled record"),
        statusBadge(item.evidence_status)
      );

      const metaParts = [typeLabel(item.type)];
      if (item.year !== undefined && item.year !== null) metaParts.push(String(item.year));
      if (item.doi) metaParts.push(item.doi);
      if (!item.doi && item.external_id) metaParts.push(item.external_id);
      button.append(top, element("span", "atlas-result__meta", metaParts.join(" · ")));

      button.addEventListener("click", () => selectItem(item, button));
      dom.results.append(button);
      buttons.push({ item, button });
    });

    if (buttons.length) {
      selectItem(buttons[0].item, buttons[0].button);
    }
  }

  async function runSearch() {
    const sequence = ++searchSeq;
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    hideNotice();
    selectedId = null;
    resetGraph("Choose a result to render its bounded network.");
    clearDetail();
    if (dom.results) dom.results.replaceChildren();
    if (dom.resultsEmpty) dom.resultsEmpty.hidden = true;
    if (dom.count) dom.count.textContent = "Loading…";
    if (dom.form) dom.form.setAttribute("aria-busy", "true");

    try {
      const payload = await api("/api/public/search", withScope({
        entity_type: dom.entity ? dom.entity.value : "researcher",
        q: dom.query ? dom.query.value.trim() : "",
        page: 1,
        page_size: CONFIG.pageSize,
      }));
      if (sequence !== searchSeq) return;
      renderResults(payload);
    } catch (error) {
      if (sequence !== searchSeq) return;
      if (dom.count) dom.count.textContent = "—";
      if (dom.resultsEmpty) {
        dom.resultsEmpty.hidden = false;
        dom.resultsEmpty.textContent = "The search could not be completed.";
      }
      renderApiError(error);
    } finally {
      if (sequence === searchSeq && dom.form) {
        dom.form.setAttribute("aria-busy", "false");
      }
    }
  }

  function markSelected(button) {
    if (!dom.results) return;
    dom.results.querySelectorAll(".atlas-result").forEach((item) => {
      item.setAttribute("aria-current", item === button ? "true" : "false");
    });
  }

  function selectItem(item, button) {
    if (!item || !item.id) return;
    selectedId = item.id;
    markSelected(button);
    loadDetail(item);
    loadGraph(item);
  }

  function renderDetail(node, profile) {
    if (!dom.detail) return;
    dom.detail.replaceChildren();
    if (dom.detailEmpty) dom.detailEmpty.hidden = true;

    const title = element("h3", "atlas-detail__title", node.name || "Untitled record");
    const badges = element("div", "atlas-detail__badges");
    badges.append(statusBadge(node.evidence_status), element("span", "atlas-badge", typeLabel(node.type)));
    dom.detail.append(title, badges);

    if (node.description) {
      dom.detail.append(element("p", "atlas-detail__description", node.description));
    }

    const facts = element("dl", "facts atlas-detail__facts");
    const metadata = node.metadata && typeof node.metadata === "object" ? node.metadata : {};
    addFact(facts, "Type", typeLabel(node.type));
    addFact(facts, "Evidence", node.evidence_status);
    addFact(facts, "External ID", node.external_id);
    addFact(facts, "Year", metadata.year || metadata.publication_year);
    addFact(facts, "Venue", metadata.venue);
    addFact(facts, "Publication date", metadata.publication_date);
    addFact(facts, "Publication type", metadata.publication_type);
    addFact(facts, "DOI", metadata.doi_url || metadata.doi, "doi");
    addFact(facts, "Works", formatNumber(metadata.works_count));
    addFact(facts, "Citations", formatNumber(metadata.cited_by_count));
    addFact(facts, "Category", metadata.category);
    addFact(facts, "Subfield", metadata.subfield);
    addFact(facts, "Field", metadata.field);
    addFact(facts, "Domain", metadata.domain);
    addFact(facts, "ROR", metadata.ror_id);
    addFact(facts, "Last known institutions", metadata.last_known_institutions);
    addFact(facts, "Provider", metadata.provider);
    addFact(facts, "Provider ID", metadata.provider_id);
    addFact(facts, "Work source", metadata.source_url, "url");
    addFact(facts, "Official page", metadata.homepage_url || metadata.official_url, "url");

    if (profile && profile.profile_kind === "researcher") {
      addFact(facts, "Publications", formatNumber(profile.publication_count));
      addFact(facts, "Topics", formatNumber(profile.topic_count));
    } else if (profile && profile.profile_kind === "publication") {
      addFact(facts, "Authors", formatNumber((profile.authors || []).length));
      addFact(facts, "Topics", formatNumber((profile.topics || []).length));
    } else if (profile && profile.profile_kind === "topic") {
      addFact(facts, "Publications", formatNumber(profile.publication_count));
      addFact(facts, "Researchers", formatNumber(profile.researcher_count));
    }
    dom.detail.append(facts);

    const source = node.source;
    if (source) {
      const sourceLine = element("p", "atlas-detail__source");
      sourceLine.append(document.createTextNode("Source: "));
      const href = safeHttpUrl(source.url);
      if (href) {
        const link = element("a", null, source.title || href);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        sourceLine.append(link);
      } else {
        sourceLine.append(document.createTextNode(source.title || "Not recorded"));
      }
      if (source.retrieved_at) {
        sourceLine.append(document.createTextNode(` · retrieved ${formatDate(source.retrieved_at) || source.retrieved_at}`));
      }
      dom.detail.append(sourceLine);
    }

    if (profile && profile.public_scope && profile.public_scope.policy) {
      dom.detail.append(element("p", "atlas-hint small muted", profile.public_scope.policy));
    }
    if (dom.detailStatus) {
      dom.detailStatus.textContent = `${typeLabel(node.type)} · ${node.evidence_status || "UNKNOWN"}`;
    }
  }

  function renderDetailOnlyNode(item) {
    if (!dom.detail) return;
    dom.detail.replaceChildren();
    if (dom.detailEmpty) dom.detailEmpty.hidden = true;
    const title = element("h3", "atlas-detail__title", item.name || item.id);
    const badges = element("div", "atlas-detail__badges");
    badges.append(statusBadge(item.evidence_status), element("span", "atlas-badge", typeLabel(item.type)));
    const note = element(
      "p",
      "atlas-hint small muted",
      "This node type is visible in the network but does not have a public profile endpoint."
    );
    dom.detail.append(title, badges, note);
    if (dom.detailStatus) {
      dom.detailStatus.textContent = `${typeLabel(item.type)} · ${item.evidence_status || "UNKNOWN"}`;
    }
  }

  async function loadDetail(item) {
    const sequence = ++detailSeq;
    const path = PROFILE_PATHS[item.type];
    if (!path) {
      renderDetailOnlyNode(item);
      return;
    }
    if (dom.detailStatus) dom.detailStatus.textContent = "Loading…";
    try {
      const payload = await api(`/api/public/${path}/${encodeURIComponent(item.id)}`, withScope({}));
      if (sequence !== detailSeq) return;
      const node = payload[payload.profile_kind] || item;
      renderDetail(node, payload);
    } catch (error) {
      if (sequence !== detailSeq) return;
      if (dom.detail) {
        dom.detail.replaceChildren(element("p", "atlas-empty", `Record unavailable. ${error.message}`));
      }
      if (dom.detailEmpty) dom.detailEmpty.hidden = true;
      if (dom.detailStatus) dom.detailStatus.textContent = "Unavailable";
    }
  }

  function cssVar(name, fallback) {
    const scope = document.querySelector(".atlas-page") || document.documentElement;
    const value = getComputedStyle(scope).getPropertyValue(name).trim();
    return value || fallback;
  }

  function graphStyle() {
    const textColor = cssVar("--text", "#131c24");
    const background = cssVar("--bg", "#ffffff");
    const muted = cssVar("--muted", "#55656f");
    const accent = cssVar("--accent", "#0d6b6b");
    const verified = cssVar("--atlas-verified-ink", "#0a5454");
    const pending = cssVar("--atlas-pending-ink", "#7a4b00");
    const palette = {
      university: cssVar("--atlas-node-organization", "#6b7f88"),
      faculty: cssVar("--atlas-node-organization", "#6b7f88"),
      researcher: cssVar("--atlas-node-researcher", "#0d8f86"),
      publication: cssVar("--atlas-node-publication", "#b07a1e"),
      topic: cssVar("--atlas-node-topic", "#6272b8"),
      technology: cssVar("--atlas-node-topic", "#8a5f9e"),
    };
    return {
      palette,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: textColor,
            "font-size": 10,
            "font-weight": 500,
            "text-outline-color": background,
            "text-outline-width": 2,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 4,
            "text-wrap": "wrap",
            "text-max-width": 120,
            "min-zoomed-font-size": 7,
            width: 28,
            height: 28,
            "border-width": 2,
            "border-color": background,
          },
        },
        {
          selector: 'node[status = "PENDING"]',
          style: {
            "border-style": "dashed",
            "border-color": pending,
          },
        },
        {
          selector: 'node[status = "VERIFIED"]',
          style: {
            "border-style": "solid",
            "border-color": verified,
          },
        },
        {
          selector: 'node[type = "researcher"]',
          style: { width: 34, height: 34 },
        },
        {
          selector: 'node[type = "publication"]',
          style: {
            width: 22,
            height: 22,
            "font-size": 8,
            "text-max-width": 90,
          },
        },
        {
          selector: 'node[type = "topic"]',
          style: {
            "font-size": 8,
            "text-max-width": 90,
          },
        },
        {
          selector: 'node[type = "university"], node[type = "faculty"]',
          style: { width: 40, height: 40 },
        },
        {
          selector: "edge",
          style: {
            width: 1.2,
            "line-color": muted,
            "target-arrow-color": muted,
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            "curve-style": "bezier",
            opacity: 0.75,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 4,
            "border-color": accent,
            "border-style": "solid",
          },
        },
      ],
    };
  }

  function renderGraph(payload, item) {
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const edges = Array.isArray(payload.edges) ? payload.edges : [];
    if (!nodes.length) {
      resetGraph("No public records are available for this record under the selected evidence scope.");
      return;
    }
    if (!window.cytoscape) {
      resetGraph("The graph library could not be loaded. The result list and record details remain available.");
      return;
    }

    if (cy) {
      cy.destroy();
      cy = null;
    }
    if (dom.graph) dom.graph.hidden = false;
    if (dom.graphEmpty) dom.graphEmpty.hidden = true;
    if (dom.graphCount) {
      dom.graphCount.textContent = `${formatNumber(nodes.length)} nodes · ${formatNumber(edges.length)} edges · ${scopeLabel(payload.public_scope)}`;
    }
    if (dom.graph) {
      dom.graph.setAttribute(
        "aria-label",
        `Research network centred on ${item.name || item.id} with ${nodes.length} nodes and ${edges.length} relationships`
      );
    }

    const graphStyleSpec = graphStyle();
    const elements = [];
    nodes.forEach((node) => {
      const wideLabel = node.type === "publication" || node.type === "topic";
      elements.push({
        data: {
          id: node.id,
          label: wideLabel ? truncate(node.name || node.id, 48) : (node.name || node.id),
          type: node.type,
          status: node.evidence_status,
          color: graphStyleSpec.palette[node.type] || graphStyleSpec.palette.topic,
        },
      });
    });
    edges.forEach((edge) => {
      elements.push({
        data: {
          id: edge.id,
          source: edge.source_node_id,
          target: edge.target_node_id,
          type: edge.type,
          status: edge.evidence_status,
        },
      });
    });

    cy = window.cytoscape({
      container: dom.graph,
      elements,
      style: graphStyleSpec.style,
      layout: {
        name: "cose",
        animate: false,
        fit: true,
        padding: 30,
        nodeRepulsion: 12000,
        idealEdgeLength: 90,
        edgeElasticity: 120,
        gravity: 0.9,
        numIter: 1000,
      },
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.18,
    });

    cy.on("tap", "node", (event) => {
      const data = event.target.data();
      loadDetail({
        id: data.id,
        type: data.type,
        name: data.label,
        evidence_status: data.status,
      });
    });
    cy.on("mouseover", "node", () => {
      if (dom.graph) dom.graph.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      if (dom.graph) dom.graph.style.cursor = "";
    });
  }

  async function loadGraph(item) {
    const sequence = ++graphSeq;
    if (!dom.graph || !window.cytoscape) {
      resetGraph("The graph library could not be loaded. The result list and record details remain available.");
      return;
    }
    if (dom.graphCount) dom.graphCount.textContent = "Loading…";
    try {
      const payload = await api("/api/public/graph", withScope({
        center_id: item.id,
        depth: CONFIG.depth,
        max_nodes: CONFIG.maxNodes,
        max_edges: CONFIG.maxEdges,
      }));
      if (sequence !== graphSeq) return;
      renderGraph(payload, item);
    } catch (error) {
      if (sequence !== graphSeq) return;
      resetGraph(`The network could not be loaded. ${error.message}`);
    }
  }

  function bindEvents() {
    if (eventsBound || !dom.form) return;
    eventsBound = true;
    dom.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });
    if (dom.entity) dom.entity.addEventListener("change", runSearch);
    if (dom.status) dom.status.addEventListener("change", runSearch);
    if (dom.query) {
      dom.query.addEventListener("input", () => {
        if (searchTimer) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(runSearch, CONFIG.searchDelay);
      });
    }
    if (dom.lockButton) {
      dom.lockButton.addEventListener("click", () => window.location.reload());
    }
  }

  async function init() {
    cacheDom();
    if (!CONFIG.apiBase) {
      if (dom.content) dom.content.hidden = true;
      if (dom.lock) dom.lock.hidden = false;
      if (!window.crypto || !window.crypto.subtle) {
        if (dom.lockStatus) {
          dom.lockStatus.textContent =
            "This browser cannot decrypt the snapshot. Open this page in a modern browser over HTTPS.";
        }
        if (dom.lockSubmit) dom.lockSubmit.disabled = true;
        return;
      }
      window.addEventListener("error", () => {
        if (dom.lock && !dom.lock.hidden && dom.lockStatus) {
          dom.lockStatus.textContent =
            "The unlock script hit an error. Reload the page and try again.";
        }
      });
      bindUnlockForm();
      return;
    }
    if (dom.lock) dom.lock.hidden = true;
    if (dom.content) dom.content.hidden = false;
    if (!apiOriginValid(CONFIG.apiBase)) {
      renderNoticeForConfig("The configured Atlas API origin is not a valid HTTP(S) URL.");
      return;
    }
    const apiProtocol = new URL(CONFIG.apiBase).protocol;
    if (window.location.protocol === "https:" && apiProtocol !== "https:") {
      renderNoticeForConfig("This page is served over HTTPS, so the Atlas API endpoint must also use HTTPS.");
      return;
    }
    bindEvents();
    try {
      await loadDataset();
    } catch (error) {
      renderApiError(error);
    }
    await runSearch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
