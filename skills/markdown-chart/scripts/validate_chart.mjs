#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "markdown-chart-validator/v1";
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_FILES = 10;
const DIMENSION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROLLED_REF_PATTERN = /^(artifact|session-file):\/\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@\/-]*$/;
const KPI_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const KPI_WIKI_REF_PATTERN = /^kb-wiki:\/\/wiki\/kb_[A-Za-z0-9]{8,64}\/versions\/v\d{8}-\d{6}-[0-9a-f]{8}\/files\/[^?#\s]+(?:#[^#\s]+)?$/;
const DISPLAY_CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ISO_4217_CURRENCIES = typeof Intl.supportedValuesOf === "function"
  ? new Set(Intl.supportedValuesOf("currency"))
  : null;
const KPI_TONES = new Set(["neutral", "positive", "warning", "negative"]);
const KPI_FORMAT_STYLES = new Set(["text", "decimal", "percent", "currency", "unit"]);
const KPI_NOTATIONS = new Set(["standard", "compact", "scientific", "engineering"]);
const KPI_TREND_TYPES = new Set(["line", "area"]);
const KPI_COMPARE_MODES = new Set(["absolute", "relative"]);
const KPI_POLARITIES = new Set(["higher-is-better", "lower-is-better", "neutral"]);
const MAX_KPI_ROWS = 2_000;
const MAX_KPI_CELLS = 40_000;
const MAX_KPI_TREND_POINTS = 500;
const MAX_DATA_NODES = 2_000;
const MAX_GRAPH_LINKS = 4_000;
const MAX_HIERARCHY_DEPTH = 20;
const MAX_TABLE_ROWS = 10_000;
const MAX_TABLE_CELLS = 200_000;
const MAX_TABLE_COLUMNS = 50;
const TABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TABLE_TYPES = new Set(["string", "number", "date", "boolean"]);
const TABLE_POLARITIES = new Set(["higher-is-better", "lower-is-better", "neutral"]);
const TABLE_NUMBER_STYLES = new Set(["decimal", "percent", "currency", "unit"]);
const TABLE_DATE_STYLES = new Set(["short", "medium", "long"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FORBIDDEN_OBJECT_KEYS = new Set(["formatter", "__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function propertyPath(parent, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function addError(errors, code, jsonPath, message) {
  errors.push({ code, path: jsonPath, message });
}

function scanObjectKeys(value, jsonPath, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanObjectKeys(item, `${jsonPath}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;

  for (const key of Object.keys(value)) {
    const childPath = propertyPath(jsonPath, key);
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      addError(
        errors,
        key === "formatter" ? "FORBIDDEN_FORMATTER" : "FORBIDDEN_OBJECT_KEY",
        childPath,
        key === "formatter"
          ? "Declarative markdown-chart specs cannot contain a formatter key."
          : `Object key ${JSON.stringify(key)} is not allowed.`,
      );
    }
    scanObjectKeys(value[key], childPath, errors);
  }
}

function validateDimensions(dimensions, errors, dataPath = "$.data") {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    addError(errors, "INVALID_DIMENSIONS", `${dataPath}.dimensions`, "dimensions must be a non-empty array.");
    return null;
  }

  const seen = new Set();
  dimensions.forEach((dimension, index) => {
    const dimensionPath = `${dataPath}.dimensions[${index}]`;
    if (typeof dimension !== "string" || !DIMENSION_PATTERN.test(dimension)) {
      addError(
        errors,
        "INVALID_DIMENSION",
        dimensionPath,
        "dimension keys must match ^[A-Za-z_][A-Za-z0-9_]*$; use a snake_case machine key and keep the readable label in series.name, title, legend, or axis name.",
      );
      return;
    }
    if (seen.has(dimension)) {
      addError(errors, "DUPLICATE_DIMENSION", dimensionPath, "dimension keys must be unique.");
      return;
    }
    seen.add(dimension);
  });
  return dimensions;
}

function validateInlineData(data, dimensions, errors) {
  if (!Array.isArray(data.source)) {
    addError(errors, "INVALID_SOURCE", "$.data.source", "inline data source must be an array of rows.");
    return;
  }
  if (Object.hasOwn(data, "ref") || Object.hasOwn(data, "format")) {
    addError(errors, "MIXED_DATA_MODE", "$.data", "inline data accepts only kind, dimensions, and source.");
  }

  data.source.forEach((row, rowIndex) => {
    const rowPath = `$.data.source[${rowIndex}]`;
    if (!Array.isArray(row)) {
      addError(errors, "INVALID_ROW", rowPath, "inline rows must be arrays.");
      return;
    }
    if (dimensions && row.length !== dimensions.length) {
      addError(
        errors,
        "ROW_WIDTH_MISMATCH",
        rowPath,
        `row width ${row.length} does not match dimensions width ${dimensions.length}.`,
      );
    }
    row.forEach((cell, columnIndex) => {
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) {
        addError(
          errors,
          "INVALID_CELL",
          `${rowPath}[${columnIndex}]`,
          "inline cells must be JSON scalars.",
        );
      }
    });
  });
}

function validateRefData(data, errors) {
  if (typeof data.ref !== "string" || !CONTROLLED_REF_PATTERN.test(data.ref)) {
    addError(
      errors,
      "INVALID_REF",
      "$.data.ref",
      "ref must use an existing artifact:// or session-file:// controlled reference.",
    );
  }
  if (!new Set(["csv", "json"]).has(data.format)) {
    addError(errors, "INVALID_REF_FORMAT", "$.data.format", "ref format must be csv or json.");
  }
  if (Object.hasOwn(data, "source")) {
    addError(errors, "MIXED_DATA_MODE", "$.data.source", "ref data cannot contain inline source rows.");
  }
}

function validateStructuredRefData(data, shape, errors) {
  validateOwnKeys(data, new Set(["kind", "shape", "ref", "format"]), "$.data", errors);
  if (typeof data.ref !== "string" || !CONTROLLED_REF_PATTERN.test(data.ref)) {
    addError(errors, "INVALID_REF", "$.data.ref", "ref must use an existing artifact:// or session-file:// controlled reference.");
  }
  if (data.format !== "json") {
    addError(errors, "INVALID_REF_FORMAT", "$.data.format", `${shape} ref data requires format json.`);
  }
}

function validNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateGraphSource(source, errors) {
  if (!isPlainObject(source)) {
    addError(errors, "INVALID_GRAPH_SOURCE", "$.data.source", "graph source must be an object with nodes and links.");
    return null;
  }
  validateOwnKeys(source, new Set(["nodes", "links"]), "$.data.source", errors);
  if (!Array.isArray(source.nodes) || source.nodes.length === 0) {
    addError(errors, "INVALID_GRAPH_NODES", "$.data.source.nodes", "graph nodes must be a non-empty array.");
    return null;
  }
  if (source.nodes.length > MAX_DATA_NODES) {
    addError(errors, "DATA_NODE_LIMIT", "$.data.source.nodes", `graph nodes exceed ${MAX_DATA_NODES}.`);
  }
  if (!Array.isArray(source.links)) {
    addError(errors, "INVALID_GRAPH_LINKS", "$.data.source.links", "graph links must be an array.");
    return null;
  }
  if (source.links.length > MAX_GRAPH_LINKS) {
    addError(errors, "GRAPH_LINK_LIMIT", "$.data.source.links", `graph links exceed ${MAX_GRAPH_LINKS}.`);
  }

  const ids = new Set();
  source.nodes.forEach((node, index) => {
    const nodePath = `$.data.source.nodes[${index}]`;
    if (!isPlainObject(node)) {
      addError(errors, "INVALID_GRAPH_NODE", nodePath, "each graph node must be an object.");
      return;
    }
    validateOwnKeys(node, new Set(["id", "name", "category"]), nodePath, errors);
    if (!validNonEmptyString(node.id)) {
      addError(errors, "INVALID_GRAPH_NODE_ID", `${nodePath}.id`, "node id must be a non-empty string.");
    } else if (ids.has(node.id)) {
      addError(errors, "DUPLICATE_GRAPH_NODE_ID", `${nodePath}.id`, "node ids must be unique.");
    } else {
      ids.add(node.id);
    }
    if (!validNonEmptyString(node.name)) {
      addError(errors, "INVALID_GRAPH_NODE_NAME", `${nodePath}.name`, "node name must be a non-empty string.");
    }
    if (node.category !== undefined && !validNonEmptyString(node.category)) {
      addError(errors, "INVALID_GRAPH_CATEGORY", `${nodePath}.category`, "node category must be a non-empty string when present.");
    }
  });

  const endpointPairs = new Set();
  source.links.forEach((link, index) => {
    const linkPath = `$.data.source.links[${index}]`;
    if (!isPlainObject(link)) {
      addError(errors, "INVALID_GRAPH_LINK", linkPath, "each graph link must be an object.");
      return;
    }
    validateOwnKeys(link, new Set(["source", "target", "value"]), linkPath, errors);
    for (const endpoint of ["source", "target"]) {
      if (!validNonEmptyString(link[endpoint]) || !ids.has(link[endpoint])) {
        addError(errors, "UNKNOWN_GRAPH_ENDPOINT", `${linkPath}.${endpoint}`, `${endpoint} must reference an existing node id.`);
      }
    }
    if (validNonEmptyString(link.source) && validNonEmptyString(link.target)) {
      const pair = `${link.source}\u0000${link.target}`;
      if (endpointPairs.has(pair)) {
        addError(errors, "DUPLICATE_GRAPH_LINK", linkPath, "directed endpoint pairs must be unique.");
      }
      endpointPairs.add(pair);
    }
    if (link.value !== undefined && !validNonNegativeNumber(link.value)) {
      addError(errors, "INVALID_GRAPH_LINK_VALUE", `${linkPath}.value`, "link value must be a finite non-negative number.");
    }
  });
  return source;
}

function validateHierarchySource(source, errors) {
  if (!Array.isArray(source) || source.length === 0) {
    addError(errors, "INVALID_HIERARCHY_SOURCE", "$.data.source", "hierarchy source must be a non-empty root array.");
    return null;
  }
  const ids = new Set();
  let nodeCount = 0;
  const leaves = [];
  const visit = (node, nodePath, depth) => {
    if (depth > MAX_HIERARCHY_DEPTH) {
      addError(errors, "HIERARCHY_DEPTH_LIMIT", nodePath, `hierarchy depth exceeds ${MAX_HIERARCHY_DEPTH}.`);
    }
    nodeCount += 1;
    if (!isPlainObject(node)) {
      addError(errors, "INVALID_HIERARCHY_NODE", nodePath, "each hierarchy node must be an object.");
      return;
    }
    validateOwnKeys(node, new Set(["id", "name", "value", "children"]), nodePath, errors);
    if (!validNonEmptyString(node.id)) {
      addError(errors, "INVALID_HIERARCHY_ID", `${nodePath}.id`, "node id must be a non-empty string.");
    } else if (ids.has(node.id)) {
      addError(errors, "DUPLICATE_HIERARCHY_ID", `${nodePath}.id`, "hierarchy node ids must be unique.");
    } else {
      ids.add(node.id);
    }
    if (!validNonEmptyString(node.name)) {
      addError(errors, "INVALID_HIERARCHY_NAME", `${nodePath}.name`, "node name must be a non-empty string.");
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      addError(errors, "INVALID_HIERARCHY_CHILDREN", `${nodePath}.children`, "children must be an array when present.");
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length > 0) {
      if (node.value !== undefined) {
        addError(errors, "NON_LEAF_HIERARCHY_VALUE", `${nodePath}.value`, "non-leaf hierarchy nodes cannot declare value.");
      }
      children.forEach((child, index) => visit(child, `${nodePath}.children[${index}]`, depth + 1));
      return;
    }
    if (node.value !== undefined && !validNonNegativeNumber(node.value)) {
      addError(errors, "INVALID_HIERARCHY_VALUE", `${nodePath}.value`, "leaf value must be a finite non-negative number.");
    }
    leaves.push({ path: nodePath, value: node.value });
  };
  source.forEach((node, index) => visit(node, `$.data.source[${index}]`, 1));
  if (nodeCount > MAX_DATA_NODES) {
    addError(errors, "DATA_NODE_LIMIT", "$.data.source", `hierarchy nodes exceed ${MAX_DATA_NODES}.`);
  }
  return { roots: source, leaves };
}

function validateStructuredSpec(spec, shape, source, errors) {
  if (!isPlainObject(spec)) {
    addError(errors, "INVALID_SPEC", "$.spec", "spec must be a JSON object.");
    return;
  }
  if (Object.hasOwn(spec, "dataset")) {
    addError(errors, "FORBIDDEN_DATASET", "$.spec.dataset", "canonical data is the only dataset source.");
  }
  if (!Array.isArray(spec.series) || spec.series.length !== 1 || !isPlainObject(spec.series[0])) {
    addError(errors, "INVALID_STRUCTURED_SERIES", "$.spec.series", "structured data requires exactly one series object.");
    return;
  }
  const series = spec.series[0];
  for (const key of ["data", "nodes", "links", "edges"]) {
    if (Object.hasOwn(series, key)) {
      addError(errors, "DUPLICATE_SERIES_DATA", `$.spec.series[0].${key}`, `${key} duplicates canonical structured data.`);
    }
  }
  const allowedTypes = shape === "graph"
    ? new Set(["sankey", "graph"])
    : new Set(["tree", "treemap", "sunburst"]);
  if (!allowedTypes.has(series.type)) {
    addError(errors, "SHAPE_SERIES_MISMATCH", "$.spec.series[0].type", `${shape} data does not support series type ${JSON.stringify(series.type)}.`);
    return;
  }
  if (!source) return;

  if (shape === "graph" && series.type === "sankey") {
    if (source.links.length === 0) {
      addError(errors, "SANKEY_LINK_REQUIRED", "$.data.source.links", "sankey requires at least one link.");
      return;
    }
    let total = 0;
    const outgoing = new Map(source.nodes.map((node) => [node.id, []]));
    source.links.forEach((link, index) => {
      const linkPath = `$.data.source.links[${index}]`;
      if (link.source === link.target) {
        addError(errors, "SANKEY_SELF_LOOP", linkPath, "sankey does not allow self-loops.");
      }
      if (!validNonNegativeNumber(link.value)) {
        addError(errors, "SANKEY_VALUE_REQUIRED", `${linkPath}.value`, "sankey links require a finite non-negative value.");
      } else {
        total += link.value;
      }
      outgoing.get(link.source)?.push(link.target);
    });
    if (total <= 0) {
      addError(errors, "SANKEY_POSITIVE_FLOW_REQUIRED", "$.data.source.links", "sankey requires a positive total flow.");
    }
    const visiting = new Set();
    const visited = new Set();
    let cyclic = false;
    const visit = (id) => {
      if (visiting.has(id)) {
        cyclic = true;
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const target of outgoing.get(id) ?? []) visit(target);
      visiting.delete(id);
      visited.add(id);
    };
    source.nodes.forEach((node) => visit(node.id));
    if (cyclic) addError(errors, "SANKEY_CYCLE", "$.data.source.links", "sankey graph must be acyclic.");
  }

  if (shape === "hierarchy") {
    if (series.type === "tree" && source.roots.length !== 1) {
      addError(errors, "TREE_ROOT_COUNT", "$.data.source", "tree requires exactly one root.");
    }
    if (series.type !== "tree") {
      source.leaves.forEach((leaf) => {
        if (!validNonNegativeNumber(leaf.value)) {
          addError(errors, "HIERARCHY_LEAF_VALUE_REQUIRED", `${leaf.path}.value`, `${series.type} leaves require a finite non-negative value.`);
        }
      });
      const total = source.leaves.reduce((sum, leaf) => sum + (validNonNegativeNumber(leaf.value) ? leaf.value : 0), 0);
      if (total <= 0) {
        addError(errors, "HIERARCHY_POSITIVE_TOTAL_REQUIRED", "$.data.source", `${series.type} requires a positive total leaf value.`);
      }
    }
  }
}

function normalizeEncodeReference(value, dimensions, jsonPath, errors) {
  const references = Array.isArray(value) ? value : [value];
  const normalized = [];
  let valid = true;

  references.forEach((reference, index) => {
    const referencePath = Array.isArray(value) ? `${jsonPath}[${index}]` : jsonPath;
    if (typeof reference === "string") {
      const dimensionIndex = dimensions.indexOf(reference);
      if (dimensionIndex === -1) {
        addError(
          errors,
          "MISSING_ENCODE_FIELD",
          referencePath,
          `encode field ${JSON.stringify(reference)} is not present in data.dimensions.`,
        );
        valid = false;
      } else {
        normalized.push(dimensionIndex);
      }
      return;
    }
    if (typeof reference === "number" && Number.isInteger(reference)) {
      if (reference === -1 || (reference >= 0 && reference < dimensions.length)) {
        normalized.push(reference);
      } else {
        addError(
          errors,
          "INVALID_ENCODE_INDEX",
          referencePath,
          `encode index ${reference} must be -1 or between 0 and ${dimensions.length - 1}.`,
        );
        valid = false;
      }
      return;
    }
    addError(
      errors,
      "INVALID_ENCODE_VALUE",
      referencePath,
      "encode values must be a dimension name, integer index, -1, or an array of them.",
    );
    valid = false;
  });

  return valid ? normalized : null;
}

function validateSpec(spec, dimensions, errors) {
  if (!isPlainObject(spec)) {
    addError(errors, "INVALID_SPEC", "$.spec", "spec must be a JSON object.");
    return;
  }
  if (Object.hasOwn(spec, "dataset")) {
    addError(errors, "FORBIDDEN_DATASET", "$.spec.dataset", "canonical data is the only dataset source.");
  }

  const xAxes = Array.isArray(spec.xAxis) ? spec.xAxis : [spec.xAxis].filter(Boolean);
  xAxes.forEach((axis, index) => {
    if (isPlainObject(axis) && Object.hasOwn(axis, "data")) {
      const axisPath = Array.isArray(spec.xAxis) ? `$.spec.xAxis[${index}].data` : "$.spec.xAxis.data";
      addError(errors, "DUPLICATE_AXIS_DATA", axisPath, "xAxis.data duplicates the canonical dataset.");
    }
  });

  if (!Array.isArray(spec.series) || spec.series.length === 0) {
    addError(errors, "INVALID_SERIES", "$.spec.series", "spec.series must be a non-empty array.");
    return;
  }
  const canonicalMappings = new Map();
  const lineOrBarSeries = [];
  spec.series.forEach((series, index) => {
    const seriesPath = `$.spec.series[${index}]`;
    if (!isPlainObject(series)) {
      addError(errors, "INVALID_SERIES_ITEM", seriesPath, "each series must be a JSON object.");
      return;
    }
    if (typeof series.type !== "string" || !series.type) {
      addError(errors, "MISSING_SERIES_TYPE", `${seriesPath}.type`, "each series must declare a type.");
    }
    if (!isPlainObject(series.encode) || Object.keys(series.encode).length === 0) {
      addError(errors, "MISSING_SERIES_ENCODE", `${seriesPath}.encode`, "each series must map the dataset with encode.");
    } else if (dimensions) {
      const normalizedEncode = {};
      for (const [channel, reference] of Object.entries(series.encode)) {
        normalizedEncode[channel] = normalizeEncodeReference(
          reference,
          dimensions,
          propertyPath(`${seriesPath}.encode`, channel),
          errors,
        );
      }
      canonicalMappings.set(index, normalizedEncode);
    }
    if (Object.hasOwn(series, "data")) {
      addError(errors, "DUPLICATE_SERIES_DATA", `${seriesPath}.data`, "series.data duplicates the canonical dataset.");
    }
    if (series.type === "line" || series.type === "bar") {
      lineOrBarSeries.push({ index, series, seriesPath });
    }
  });

  if (lineOrBarSeries.length < 2) return;

  const names = new Set();
  const mappings = new Map();
  for (const { index, series, seriesPath } of lineOrBarSeries) {
    if (
      typeof series.name !== "string" ||
      series.name.length === 0 ||
      series.name.trim() !== series.name ||
      DISPLAY_CONTROL_CHARACTER.test(series.name)
    ) {
      addError(
        errors,
        "INVALID_SERIES_NAME",
        `${seriesPath}.name`,
        "multiple line/bar series require an explicit non-empty series.name.",
      );
    } else if (names.has(series.name)) {
      addError(
        errors,
        "DUPLICATE_SERIES_NAME",
        `${seriesPath}.name`,
        "series.name must be unique among line/bar series.",
      );
    } else {
      names.add(series.name);
    }

    const encode = canonicalMappings.get(index);
    if (!encode?.x || !encode?.y) continue;
    if (
      encode.x.length === 0 ||
      encode.y.length === 0 ||
      encode.x.includes(-1) ||
      encode.y.includes(-1)
    ) {
      continue;
    }
    const mappingKey = JSON.stringify([series.type, encode.x, encode.y]);
    const previousPath = mappings.get(mappingKey);
    if (previousPath) {
      addError(
        errors,
        "DUPLICATE_SERIES_MAPPING",
        `${seriesPath}.encode`,
        `${series.type} series duplicates the canonical x/y mapping of ${previousPath}.`,
      );
    } else {
      mappings.set(mappingKey, seriesPath);
    }
  }
}

function validateOwnKeys(value, allowed, jsonPath, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, "UNKNOWN_KEY", propertyPath(jsonPath, key), `${jsonPath} does not allow ${JSON.stringify(key)}.`);
    }
  }
}

function validateDisplayString(value, jsonPath, maxCodePoints, errors) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    [...value].length > maxCodePoints ||
    DISPLAY_CONTROL_CHARACTER.test(value)
  ) {
    addError(
      errors,
      "INVALID_DISPLAY_STRING",
      jsonPath,
      `value must be a trimmed display string of 1-${maxCodePoints} Unicode code points without control characters.`,
    );
    return false;
  }
  return true;
}

function validateTableData(data, errors) {
  if (!isPlainObject(data)) {
    addError(errors, "INVALID_TABLE_DATA", "$.data", "table data must be an inline or ref object.");
    return null;
  }
  if (data.shape !== undefined && data.shape !== "table") {
    addError(errors, "UNSUPPORTED_TABLE_DATA_SHAPE", "$.data.shape", "table accepts only table data.");
    return null;
  }
  const dimensions = data.dimensions === undefined
    ? null
    : validateDimensions(data.dimensions, errors);
  if (data.kind === "ref") {
    validateOwnKeys(data, new Set(["kind", "shape", "ref", "format", "dimensions"]), "$.data", errors);
    if (typeof data.ref !== "string" || !CONTROLLED_REF_PATTERN.test(data.ref)) {
      addError(errors, "INVALID_TABLE_DATA_REF", "$.data.ref", "table ref must use an existing artifact:// or session-file:// controlled reference.");
    }
    if (data.format !== undefined && data.format !== "csv" && data.format !== "json") {
      addError(errors, "INVALID_TABLE_DATA_FORMAT", "$.data.format", "table ref format must be csv or json when present.");
    }
    return { fields: dimensions ? new Set(dimensions) : null, rows: null };
  }
  if (data.kind !== "inline") {
    addError(errors, "INVALID_TABLE_DATA_KIND", "$.data.kind", "table data kind must be inline or ref.");
    return null;
  }
  validateOwnKeys(data, new Set(["kind", "shape", "dimensions", "source"]), "$.data", errors);
  if (!Array.isArray(data.source)) {
    addError(errors, "INVALID_TABLE_SOURCE", "$.data.source", "table inline source must be an array of rows.");
    return { fields: dimensions ? new Set(dimensions) : new Set(), rows: null };
  }
  if (data.source.length > MAX_TABLE_ROWS) {
    addError(errors, "TABLE_DATA_LIMIT", "$.data.source", `table source exceeds ${MAX_TABLE_ROWS} rows.`);
  }
  const fields = new Set(dimensions ?? []);
  const rows = [];
  data.source.forEach((row, rowIndex) => {
    const rowPath = `$.data.source[${rowIndex}]`;
    const normalized = {};
    if (Array.isArray(row)) {
      if (!dimensions) {
        addError(errors, "TABLE_DIMENSIONS_REQUIRED", rowPath, "array table rows require data.dimensions.");
      } else if (row.length !== dimensions.length) {
        addError(errors, "ROW_WIDTH_MISMATCH", rowPath, `row width ${row.length} does not match dimensions width ${dimensions.length}.`);
      }
      row.forEach((cell, columnIndex) => {
        const field = dimensions?.[columnIndex];
        if (field) normalized[field] = cell;
        if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) {
          addError(errors, "INVALID_CELL", `${rowPath}[${columnIndex}]`, "table cells must be JSON scalars.");
        } else if (typeof cell === "number" && !Number.isFinite(cell)) {
          addError(errors, "INVALID_CELL", `${rowPath}[${columnIndex}]`, "table numeric cells must be finite.");
        }
      });
      rows.push(normalized);
      return;
    }
    if (!isPlainObject(row)) {
      addError(errors, "INVALID_TABLE_ROW", rowPath, "table rows must be arrays or scalar-valued objects.");
      rows.push(normalized);
      return;
    }
    for (const [field, cell] of Object.entries(row)) {
      if (!DIMENSION_PATTERN.test(field)) {
        addError(errors, "INVALID_TABLE_FIELD", propertyPath(rowPath, field), "table object row keys must be ASCII machine fields.");
      }
      fields.add(field);
      normalized[field] = cell;
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) {
        addError(errors, "INVALID_CELL", propertyPath(rowPath, field), "table cells must be JSON scalars.");
      } else if (typeof cell === "number" && !Number.isFinite(cell)) {
        addError(errors, "INVALID_CELL", propertyPath(rowPath, field), "table numeric cells must be finite.");
      }
    }
    rows.push(normalized);
  });
  if (data.source.length * fields.size > MAX_TABLE_CELLS) {
    addError(errors, "TABLE_DATA_LIMIT", "$.data.source", `table source exceeds ${MAX_TABLE_CELLS} materialized cells.`);
  }
  return { fields, rows };
}

function validateTableFormat(format, jsonPath, errors) {
  if (!isPlainObject(format)) {
    addError(errors, "INVALID_TABLE_FORMAT", jsonPath, "table format must be an object.");
    return null;
  }
  if (Object.hasOwn(format, "dateStyle")) {
    validateOwnKeys(format, new Set(["dateStyle"]), jsonPath, errors);
    if (!TABLE_DATE_STYLES.has(format.dateStyle)) {
      addError(errors, "INVALID_TABLE_DATE_STYLE", `${jsonPath}.dateStyle`, "dateStyle must be short, medium, or long.");
    }
    return { kind: "date" };
  }
  validateOwnKeys(format, new Set([
    "style", "currency", "unit", "notation", "minimumFractionDigits",
    "maximumFractionDigits", "prefix", "suffix", "nullDisplay",
  ]), jsonPath, errors);
  if (!TABLE_NUMBER_STYLES.has(format.style)) {
    addError(errors, "INVALID_TABLE_FORMAT_STYLE", `${jsonPath}.style`, "style must be decimal, percent, currency, or unit.");
    return { kind: "number" };
  }
  if (format.notation !== undefined && !KPI_NOTATIONS.has(format.notation)) {
    addError(errors, "INVALID_TABLE_NOTATION", `${jsonPath}.notation`, "notation is not supported.");
  }
  for (const key of ["minimumFractionDigits", "maximumFractionDigits"]) {
    if (format[key] !== undefined && (!Number.isInteger(format[key]) || format[key] < 0 || format[key] > 20)) {
      addError(errors, "INVALID_TABLE_FRACTION_DIGITS", `${jsonPath}.${key}`, `${key} must be an integer between 0 and 20.`);
    }
  }
  if (
    Number.isInteger(format.minimumFractionDigits)
    && Number.isInteger(format.maximumFractionDigits)
    && format.minimumFractionDigits > format.maximumFractionDigits
  ) {
    addError(errors, "INVALID_TABLE_FRACTION_DIGITS", jsonPath, "minimumFractionDigits must not exceed maximumFractionDigits.");
  }
  if (format.prefix !== undefined) validateDisplayString(format.prefix, `${jsonPath}.prefix`, 32, errors);
  if (format.suffix !== undefined) validateDisplayString(format.suffix, `${jsonPath}.suffix`, 32, errors);
  if (format.nullDisplay !== undefined) validateDisplayString(format.nullDisplay, `${jsonPath}.nullDisplay`, 80, errors);
  if (format.style === "currency") {
    if (
      typeof format.currency !== "string"
      || !/^[A-Z]{3}$/.test(format.currency)
      || (ISO_4217_CURRENCIES && !ISO_4217_CURRENCIES.has(format.currency))
    ) {
      addError(errors, "INVALID_TABLE_CURRENCY", `${jsonPath}.currency`, "currency must be an uppercase ISO 4217 code.");
    }
  } else if (format.currency !== undefined) {
    addError(errors, "INVALID_TABLE_FORMAT_OPTION", `${jsonPath}.currency`, "currency is only allowed for currency style.");
  }
  if (format.style === "unit") {
    if (typeof format.unit !== "string" || format.unit.length === 0 || format.unit.length > 40) {
      addError(errors, "INVALID_TABLE_UNIT", `${jsonPath}.unit`, "unit must be a supported Intl unit string.");
    }
  } else if (format.unit !== undefined) {
    addError(errors, "INVALID_TABLE_FORMAT_OPTION", `${jsonPath}.unit`, "unit is only allowed for unit style.");
  }
  try {
    new Intl.NumberFormat("en-US", {
      style: ["currency", "percent", "unit"].includes(format.style) ? format.style : "decimal",
      ...(format.currency ? { currency: format.currency } : {}),
      ...(format.unit ? { unit: format.unit } : {}),
      ...(format.notation ? { notation: format.notation } : {}),
      ...(format.minimumFractionDigits !== undefined ? { minimumFractionDigits: format.minimumFractionDigits } : {}),
      ...(format.maximumFractionDigits !== undefined ? { maximumFractionDigits: format.maximumFractionDigits } : {}),
    });
  } catch {
    addError(errors, "INVALID_TABLE_FORMAT", jsonPath, "format is not a supported Intl.NumberFormat configuration.");
  }
  return { kind: "number" };
}

function validateTableCell(cell, jsonPath, fields, errors) {
  if (cell === undefined) return null;
  if (!isPlainObject(cell)) {
    addError(errors, "INVALID_TABLE_CELL", jsonPath, "cell must be an object.");
    return null;
  }
  if (cell.kind === "change") {
    validateOwnKeys(cell, new Set(["kind", "polarity"]), jsonPath, errors);
    if (cell.polarity !== undefined && !TABLE_POLARITIES.has(cell.polarity)) {
      addError(errors, "INVALID_TABLE_POLARITY", `${jsonPath}.polarity`, "polarity is not supported.");
    }
    return { kind: "change" };
  }
  if (cell.kind === "bar" || cell.kind === "progress") {
    validateOwnKeys(cell, new Set(["kind", "min", "max", "clamp"]), jsonPath, errors);
    for (const key of ["min", "max"]) {
      if (cell[key] !== undefined && (typeof cell[key] !== "number" || !Number.isFinite(cell[key]))) {
        addError(errors, "INVALID_TABLE_BOUND", `${jsonPath}.${key}`, `${key} must be a finite number.`);
      }
    }
    if (Number.isFinite(cell.min) && Number.isFinite(cell.max) && cell.max <= cell.min) {
      addError(errors, "INVALID_TABLE_BOUND", jsonPath, "max must be greater than min.");
    }
    if (cell.clamp !== undefined && typeof cell.clamp !== "boolean") {
      addError(errors, "INVALID_TABLE_CLAMP", `${jsonPath}.clamp`, "clamp must be a boolean.");
    }
    return { kind: cell.kind };
  }
  if (cell.kind === "sparkline") {
    validateOwnKeys(cell, new Set(["kind", "fields", "labels", "scale"]), jsonPath, errors);
    if (!Array.isArray(cell.fields) || cell.fields.length < 2 || cell.fields.length > MAX_TABLE_COLUMNS) {
      addError(errors, "INVALID_TABLE_SPARKLINE_FIELDS", `${jsonPath}.fields`, "sparkline fields must contain 2-50 machine fields.");
      return { kind: "sparkline", fields: [] };
    }
    const seen = new Set();
    cell.fields.forEach((field, index) => {
      const fieldPath = `${jsonPath}.fields[${index}]`;
      if (typeof field !== "string" || !DIMENSION_PATTERN.test(field)) {
        addError(errors, "INVALID_TABLE_FIELD", fieldPath, "sparkline fields must be ASCII machine fields.");
      } else if (seen.has(field)) {
        addError(errors, "DUPLICATE_TABLE_FIELD", fieldPath, "sparkline fields must be unique.");
      } else {
        seen.add(field);
      }
      if (fields && !fields.has(field)) {
        addError(errors, "MISSING_TABLE_FIELD", fieldPath, `field ${JSON.stringify(field)} is not present in table data.`);
      }
    });
    if (cell.labels !== undefined) {
      if (!Array.isArray(cell.labels) || cell.labels.length !== cell.fields.length) {
        addError(errors, "INVALID_TABLE_SPARKLINE_LABELS", `${jsonPath}.labels`, "sparkline labels must match fields length.");
      } else {
        cell.labels.forEach((label, index) => validateDisplayString(label, `${jsonPath}.labels[${index}]`, 120, errors));
      }
    }
    if (cell.scale !== undefined && cell.scale !== "column" && cell.scale !== "row") {
      addError(errors, "INVALID_TABLE_SPARKLINE_SCALE", `${jsonPath}.scale`, "sparkline scale must be column or row.");
    }
    return { kind: "sparkline", fields: cell.fields };
  }
  addError(errors, "INVALID_TABLE_CELL_KIND", `${jsonPath}.kind`, "cell kind must be change, bar, progress, or sparkline.");
  return null;
}

function inferTableColumnType(rows, field) {
  if (!rows || !field) return null;
  const values = rows
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined);
  if (values.length > 0 && values.every((value) => typeof value === "number")) return "number";
  if (values.length > 0 && values.every((value) => typeof value === "boolean")) return "boolean";
  return "string";
}

function validateTableColumnValues(column, columnPath, cell, resolvedType, tableData, errors) {
  if (cell && cell.kind !== "sparkline" && resolvedType !== null && resolvedType !== "number") {
    addError(errors, "TABLE_CELL_TYPE_MISMATCH", `${columnPath}.type`, `${cell.kind} cells require type number.`);
  }
  if (!tableData?.rows) return;
  if (column.field) {
    for (let index = 0; index < tableData.rows.length; index += 1) {
      const value = tableData.rows[index][column.field];
      if (value === null || value === undefined) continue;
      const valuePath = `$.data.source[${index}].${column.field}`;
      if (resolvedType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
        addError(errors, "TABLE_TYPE_MISMATCH", valuePath, `${column.field} must contain finite numbers.`);
      } else if (resolvedType === "boolean" && typeof value !== "boolean") {
        addError(errors, "TABLE_TYPE_MISMATCH", valuePath, `${column.field} must contain booleans.`);
      } else if (resolvedType === "date") {
        const validDate = typeof value === "string"
          && (ISO_DATE.test(value) || ISO_TIMESTAMP_WITH_ZONE.test(value))
          && Number.isFinite(Date.parse(ISO_DATE.test(value) ? `${value}T00:00:00Z` : value));
        if (!validDate) addError(errors, "TABLE_TYPE_MISMATCH", valuePath, `${column.field} must contain ISO dates or timestamps with a timezone.`);
      }
    }
  }
  if (cell?.kind === "sparkline") {
    cell.fields.forEach((field) => {
      tableData.rows.forEach((row, index) => {
        const value = row[field];
        if (value !== null && value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
          addError(errors, "TABLE_TYPE_MISMATCH", `$.data.source[${index}].${field}`, `sparkline field ${field} must contain finite numbers or null.`);
        }
      });
    });
  }
  if ((cell?.kind === "bar" || cell?.kind === "progress") && column.field) {
    const values = tableData.rows
      .map((row) => row[column.field])
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    const resolvedMin = Number.isFinite(column.cell.min) ? column.cell.min : 0;
    const resolvedMax = Number.isFinite(column.cell.max)
      ? column.cell.max
      : values.length > 0
        ? Math.max(...values)
        : 1;
    if (resolvedMax <= resolvedMin) {
      addError(errors, "INVALID_TABLE_BOUND", `${columnPath}.cell`, "resolved max must be greater than min.");
    }
    if (column.cell.clamp === false && values.some((value) => value < resolvedMin || value > resolvedMax)) {
      addError(errors, "TABLE_CELL_VALUE_OUT_OF_RANGE", `${columnPath}.cell`, "cell values must stay within min and max when clamp is false.");
    }
  }
}

function validateTableSpec(spec, tableData, errors) {
  if (!isPlainObject(spec)) {
    addError(errors, "INVALID_TABLE_SPEC", "$.spec", "table spec must be an object.");
    return;
  }
  validateOwnKeys(spec, new Set(["title", "height", "columns", "initialSort"]), "$.spec", errors);
  if (spec.title !== undefined) validateDisplayString(spec.title, "$.spec.title", 120, errors);
  if (spec.height !== undefined && (!Number.isInteger(spec.height) || spec.height < 240 || spec.height > 720)) {
    addError(errors, "INVALID_TABLE_HEIGHT", "$.spec.height", "height must be an integer between 240 and 720.");
  }
  const columns = [];
  if (spec.columns !== undefined) {
    if (!Array.isArray(spec.columns) || spec.columns.length === 0 || spec.columns.length > MAX_TABLE_COLUMNS) {
      addError(errors, "INVALID_TABLE_COLUMNS", "$.spec.columns", "columns must contain 1-50 entries.");
    } else {
      const effectiveIds = new Set();
      spec.columns.forEach((column, index) => {
        const columnPath = `$.spec.columns[${index}]`;
        if (!isPlainObject(column)) {
          addError(errors, "INVALID_TABLE_COLUMN", columnPath, "each table column must be an object.");
          return;
        }
        validateOwnKeys(column, new Set([
          "field", "id", "title", "type", "width", "pinned", "sortable", "filter", "format", "cell",
        ]), columnPath, errors);
        const fieldValid = typeof column.field === "string" && DIMENSION_PATTERN.test(column.field);
        if (column.field !== undefined && !fieldValid) {
          addError(errors, "INVALID_TABLE_FIELD", `${columnPath}.field`, "field must be an ASCII machine field.");
        }
        if (column.id !== undefined && (typeof column.id !== "string" || !TABLE_ID_PATTERN.test(column.id))) {
          addError(errors, "INVALID_TABLE_COLUMN_ID", `${columnPath}.id`, "id must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$.");
        }
        const cell = validateTableCell(column.cell, `${columnPath}.cell`, tableData?.fields, errors);
        if (!fieldValid && !(cell?.kind === "sparkline" && typeof column.id === "string" && TABLE_ID_PATTERN.test(column.id))) {
          addError(errors, "TABLE_COLUMN_BINDING_REQUIRED", columnPath, "column requires field, or id for a derived sparkline.");
        }
        const effectiveId = column.id ?? column.field;
        if (typeof effectiveId === "string") {
          if (effectiveIds.has(effectiveId)) {
            addError(errors, "DUPLICATE_TABLE_COLUMN_ID", columnPath, "table column effective ids must be unique.");
          }
          effectiveIds.add(effectiveId);
        }
        if (fieldValid && tableData?.fields && !tableData.fields.has(column.field)) {
          addError(errors, "MISSING_TABLE_FIELD", `${columnPath}.field`, `field ${JSON.stringify(column.field)} is not present in table data.`);
        }
        if (column.title !== undefined) validateDisplayString(column.title, `${columnPath}.title`, 120, errors);
        if (column.type !== undefined && !TABLE_TYPES.has(column.type)) {
          addError(errors, "INVALID_TABLE_TYPE", `${columnPath}.type`, "type must be string, number, date, or boolean.");
        }
        if (column.width !== undefined && (!Number.isInteger(column.width) || column.width < 72 || column.width > 600)) {
          addError(errors, "INVALID_TABLE_WIDTH", `${columnPath}.width`, "width must be an integer between 72 and 600.");
        }
        if (column.pinned !== undefined && column.pinned !== "left" && column.pinned !== "right") {
          addError(errors, "INVALID_TABLE_PINNED", `${columnPath}.pinned`, "pinned must be left or right.");
        }
        for (const key of ["sortable", "filter"]) {
          if (column[key] !== undefined && typeof column[key] !== "boolean") {
            addError(errors, "INVALID_TABLE_BOOLEAN_OPTION", `${columnPath}.${key}`, `${key} must be a boolean.`);
          }
        }
        const format = column.format === undefined ? null : validateTableFormat(column.format, `${columnPath}.format`, errors);
        const resolvedType = column.type ?? inferTableColumnType(tableData?.rows, column.field);
        if (format?.kind === "date" && column.type !== "date") {
          addError(errors, "TABLE_FORMAT_TYPE_MISMATCH", `${columnPath}.format`, "dateStyle requires type date.");
        }
        if (format?.kind === "number" && resolvedType !== null && resolvedType !== "number") {
          addError(errors, "TABLE_FORMAT_TYPE_MISMATCH", `${columnPath}.format`, "numeric format requires type number.");
        }
        validateTableColumnValues(column, columnPath, cell, resolvedType, tableData, errors);
        columns.push({ field: column.field, sortable: column.sortable, cell });
      });
    }
  } else if (tableData?.fields && tableData.fields.size > MAX_TABLE_COLUMNS) {
    addError(errors, "TABLE_INFERRED_COLUMN_LIMIT", "$.data", "table data has more than 50 inferred fields; provide explicit columns.");
  }
  if (spec.initialSort !== undefined) {
    if (!Array.isArray(spec.initialSort) || spec.initialSort.length === 0 || spec.initialSort.length > 3) {
      addError(errors, "INVALID_TABLE_INITIAL_SORT", "$.spec.initialSort", "initialSort must contain 1-3 entries.");
    } else {
      const seen = new Set();
      spec.initialSort.forEach((sort, index) => {
        const sortPath = `$.spec.initialSort[${index}]`;
        if (!isPlainObject(sort)) {
          addError(errors, "INVALID_TABLE_INITIAL_SORT", sortPath, "sort entry must be an object.");
          return;
        }
        validateOwnKeys(sort, new Set(["field", "direction"]), sortPath, errors);
        if (typeof sort.field !== "string" || !DIMENSION_PATTERN.test(sort.field)) {
          addError(errors, "INVALID_TABLE_FIELD", `${sortPath}.field`, "sort field must be an ASCII machine field.");
        } else if (seen.has(sort.field)) {
          addError(errors, "DUPLICATE_TABLE_SORT", `${sortPath}.field`, "initialSort fields must be unique.");
        } else {
          seen.add(sort.field);
        }
        if (sort.direction !== "asc" && sort.direction !== "desc") {
          addError(errors, "INVALID_TABLE_SORT_DIRECTION", `${sortPath}.direction`, "direction must be asc or desc.");
        }
        if (Array.isArray(spec.columns)) {
          const column = columns.find((candidate) => candidate.field === sort.field);
          if (!column || column.sortable === false || column.cell?.kind === "sparkline") {
            addError(errors, "UNSORTABLE_TABLE_FIELD", `${sortPath}.field`, "initialSort must reference a sortable source column.");
          }
        } else if (tableData?.fields && !tableData.fields.has(sort.field)) {
          addError(errors, "MISSING_TABLE_FIELD", `${sortPath}.field`, `field ${JSON.stringify(sort.field)} is not present in table data.`);
        }
      });
    }
  }
}

function validateTableEnvelope(envelope, errors) {
  validateOwnKeys(envelope, new Set(["version", "renderer", "data", "spec"]), "$", errors);
  const tableData = validateTableData(envelope.data, errors);
  validateTableSpec(envelope.spec, tableData, errors);
}

function validateKpiDimensions(dimensions, errors, dataPath) {
  if (dimensions === undefined) return null;
  return validateDimensions(dimensions, errors, dataPath);
}

function validateKpiData(data, errors, dataPath) {
  if (!isPlainObject(data)) {
    addError(errors, "INVALID_KPI_DATA", dataPath, "kpi data must be an inline or ref object.");
    return null;
  }
  if (data.shape !== undefined && data.shape !== "table") {
    addError(errors, "UNSUPPORTED_KPI_DATA_SHAPE", `${dataPath}.shape`, "kpi accepts only table data.");
    return null;
  }
  const dimensions = validateKpiDimensions(data.dimensions, errors, dataPath);
  if (data.kind === "ref") {
    validateOwnKeys(data, new Set(["kind", "ref", "format", "dimensions"]), dataPath, errors);
    if (typeof data.ref !== "string" || !CONTROLLED_REF_PATTERN.test(data.ref)) {
      addError(errors, "INVALID_KPI_DATA_REF", `${dataPath}.ref`, "kpi data ref must use an existing artifact:// or session-file:// controlled reference.");
    }
    if (data.format !== undefined && data.format !== "csv" && data.format !== "json") {
      addError(errors, "INVALID_KPI_DATA_FORMAT", `${dataPath}.format`, "kpi data format must be csv or json when present.");
    }
    return {
      dimensions,
      fields: dimensions ? new Set(dimensions) : null,
      rows: null,
      path: dataPath,
      rowCount: 0,
      cellCount: 0,
    };
  }
  if (data.kind !== "inline") {
    addError(errors, "INVALID_KPI_DATA_KIND", `${dataPath}.kind`, "kpi data kind must be inline or ref.");
    return null;
  }
  validateOwnKeys(data, new Set(["kind", "dimensions", "source"]), dataPath, errors);
  if (!Array.isArray(data.source)) {
    addError(errors, "INVALID_KPI_SOURCE", `${dataPath}.source`, "kpi inline source must be an array of rows.");
    return {
      dimensions,
      fields: dimensions ? new Set(dimensions) : new Set(),
      rows: null,
      path: dataPath,
      rowCount: 0,
      cellCount: 0,
    };
  }
  if (data.source.length > MAX_KPI_ROWS) {
    addError(errors, "KPI_DATA_LIMIT", `${dataPath}.source`, `kpi source exceeds ${MAX_KPI_ROWS} rows.`);
  }
  const fields = new Set(dimensions ?? []);
  let cellCount = 0;
  data.source.forEach((row, rowIndex) => {
    const rowPath = `${dataPath}.source[${rowIndex}]`;
    if (Array.isArray(row)) {
      if (!dimensions) {
        addError(errors, "KPI_DIMENSIONS_REQUIRED", rowPath, `array KPI rows require ${dataPath}.dimensions.`);
      } else if (row.length !== dimensions.length) {
        addError(errors, "ROW_WIDTH_MISMATCH", rowPath, `row width ${row.length} does not match dimensions width ${dimensions.length}.`);
      }
      row.forEach((cell, columnIndex) => {
        cellCount += 1;
        if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) {
          addError(errors, "INVALID_CELL", `${rowPath}[${columnIndex}]`, "KPI cells must be JSON scalars.");
        }
      });
      return;
    }
    if (!isPlainObject(row)) {
      addError(errors, "INVALID_KPI_ROW", rowPath, "KPI rows must be arrays or scalar-valued objects.");
      return;
    }
    for (const [key, cell] of Object.entries(row)) {
      cellCount += 1;
      if (!DIMENSION_PATTERN.test(key)) {
        addError(errors, "INVALID_KPI_FIELD", propertyPath(rowPath, key), "KPI object row keys must be machine field names.");
      }
      fields.add(key);
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) {
        addError(errors, "INVALID_CELL", propertyPath(rowPath, key), "KPI cells must be JSON scalars.");
      }
    }
  });
  if (cellCount > MAX_KPI_CELLS) {
    addError(errors, "KPI_DATA_LIMIT", `${dataPath}.source`, `kpi source exceeds ${MAX_KPI_CELLS} cells.`);
  }
  return {
    dimensions,
    fields,
    rows: data.source,
    path: dataPath,
    rowCount: data.source.length,
    cellCount,
  };
}

function validateKpiField(field, jsonPath, fields, errors) {
  if (typeof field !== "string" || !DIMENSION_PATTERN.test(field)) {
    addError(errors, "INVALID_KPI_FIELD", jsonPath, "field must be a machine key matching ^[A-Za-z_][A-Za-z0-9_]*$.");
    return null;
  }
  if (fields && !fields.has(field)) {
    addError(errors, "MISSING_KPI_FIELD", jsonPath, `field ${JSON.stringify(field)} is not present in the selected dataset.`);
  }
  return field;
}

function validateKpiBinding(binding, jsonPath, fields, errors, kind) {
  if (!isPlainObject(binding)) {
    addError(errors, "INVALID_KPI_BINDING", jsonPath, "binding must be an object with exactly one field or literal.");
    return null;
  }
  validateOwnKeys(binding, new Set(["field", "literal"]), jsonPath, errors);
  const hasField = Object.hasOwn(binding, "field");
  const hasLiteral = Object.hasOwn(binding, "literal");
  if (hasField === hasLiteral) {
    addError(errors, "INVALID_KPI_BINDING", jsonPath, "binding must contain exactly one of field or literal.");
    return null;
  }
  if (hasField) return { field: validateKpiField(binding.field, `${jsonPath}.field`, fields, errors) };
  if (kind === "tone") {
    if (!KPI_TONES.has(binding.literal)) {
      addError(errors, "INVALID_KPI_TONE", `${jsonPath}.literal`, "tone literal must be neutral, positive, warning, or negative.");
    }
  } else {
    validateDisplayString(binding.literal, `${jsonPath}.literal`, 120, errors);
  }
  return { literal: binding.literal };
}

function validateKpiFormat(format, jsonPath, errors) {
  if (format === undefined) return { style: "text" };
  if (!isPlainObject(format)) {
    addError(errors, "INVALID_KPI_FORMAT", jsonPath, "format must be an object.");
    return null;
  }
  validateOwnKeys(format, new Set([
    "style", "currency", "unit", "notation", "minimumFractionDigits",
    "maximumFractionDigits", "prefix", "suffix", "nullDisplay",
  ]), jsonPath, errors);
  if (!KPI_FORMAT_STYLES.has(format.style)) {
    addError(errors, "INVALID_KPI_FORMAT_STYLE", `${jsonPath}.style`, "style must be text, decimal, percent, currency, or unit.");
    return null;
  }
  if (format.notation !== undefined && !KPI_NOTATIONS.has(format.notation)) {
    addError(errors, "INVALID_KPI_NOTATION", `${jsonPath}.notation`, "notation is not supported.");
  }
  for (const key of ["minimumFractionDigits", "maximumFractionDigits"]) {
    if (format[key] !== undefined && (!Number.isInteger(format[key]) || format[key] < 0 || format[key] > 20)) {
      addError(errors, "INVALID_KPI_FRACTION_DIGITS", `${jsonPath}.${key}`, `${key} must be an integer between 0 and 20.`);
    }
  }
  if (
    Number.isInteger(format.minimumFractionDigits)
    && Number.isInteger(format.maximumFractionDigits)
    && format.minimumFractionDigits > format.maximumFractionDigits
  ) {
    addError(errors, "INVALID_KPI_FRACTION_DIGITS", jsonPath, "minimumFractionDigits must not exceed maximumFractionDigits.");
  }
  if (format.prefix !== undefined) validateDisplayString(format.prefix, `${jsonPath}.prefix`, 32, errors);
  if (format.suffix !== undefined) validateDisplayString(format.suffix, `${jsonPath}.suffix`, 32, errors);
  if (format.nullDisplay !== undefined) validateDisplayString(format.nullDisplay, `${jsonPath}.nullDisplay`, 80, errors);
  if (format.style === "text") {
    for (const key of ["currency", "unit", "notation", "minimumFractionDigits", "maximumFractionDigits"]) {
      if (format[key] !== undefined) addError(errors, "INVALID_KPI_FORMAT_OPTION", `${jsonPath}.${key}`, `${key} is not allowed for text style.`);
    }
  }
  if (format.style === "currency") {
    if (
      typeof format.currency !== "string"
      || !/^[A-Z]{3}$/.test(format.currency)
      || (ISO_4217_CURRENCIES && !ISO_4217_CURRENCIES.has(format.currency))
    ) {
      addError(errors, "INVALID_KPI_CURRENCY", `${jsonPath}.currency`, "currency must be an uppercase ISO 4217 code.");
    }
  } else if (format.style !== "text" && format.currency !== undefined) {
    addError(errors, "INVALID_KPI_FORMAT_OPTION", `${jsonPath}.currency`, "currency is only allowed for currency style.");
  }
  if (format.style === "unit") {
    if (typeof format.unit !== "string" || format.unit.length === 0 || format.unit.length > 40) {
      addError(errors, "INVALID_KPI_UNIT", `${jsonPath}.unit`, "unit must be a supported Intl unit string.");
    }
  } else if (format.style !== "text" && format.unit !== undefined) {
    addError(errors, "INVALID_KPI_FORMAT_OPTION", `${jsonPath}.unit`, "unit is only allowed for unit style.");
  }
  if (format.style !== "text") {
    try {
      new Intl.NumberFormat("en-US", {
        style: ["currency", "percent", "unit"].includes(format.style) ? format.style : "decimal",
        ...(format.currency ? { currency: format.currency } : {}),
        ...(format.unit ? { unit: format.unit } : {}),
        ...(format.notation ? { notation: format.notation } : {}),
        ...(format.minimumFractionDigits !== undefined ? { minimumFractionDigits: format.minimumFractionDigits } : {}),
        ...(format.maximumFractionDigits !== undefined ? { maximumFractionDigits: format.maximumFractionDigits } : {}),
      });
    } catch {
      addError(errors, "INVALID_KPI_FORMAT", jsonPath, "format is not a supported Intl.NumberFormat configuration.");
    }
  }
  return { style: format.style };
}

function kpiCell(data, row, rowIndex, field) {
  if (Array.isArray(row)) {
    const columnIndex = data.dimensions?.indexOf(field) ?? -1;
    return { value: columnIndex < 0 ? undefined : row[columnIndex], path: `${data.path}.source[${rowIndex}][${columnIndex}]` };
  }
  return {
    value: Object.hasOwn(row, field) ? row[field] : undefined,
    path: propertyPath(`${data.path}.source[${rowIndex}]`, field),
  };
}

function lastKpiCell(data, field) {
  if (!data.rows) return null;
  for (let index = data.rows.length - 1; index >= 0; index -= 1) {
    const cell = kpiCell(data, data.rows[index], index, field);
    if (cell.value !== null && cell.value !== undefined) return cell;
  }
  return null;
}

function validateKpiStatus(status, jsonPath, data, errors) {
  if (!isPlainObject(status)) {
    addError(errors, "INVALID_KPI_STATUS", jsonPath, "status must be an object.");
    return;
  }
  validateOwnKeys(status, new Set(["text", "tone"]), jsonPath, errors);
  const text = status.text === undefined
    ? null
    : validateKpiBinding(status.text, `${jsonPath}.text`, data?.fields, errors, "text");
  if (text?.field && data?.rows) {
    const cell = lastKpiCell(data, text.field);
    if (cell) validateDisplayString(cell.value, cell.path, 120, errors);
  }
  const tone = status.tone === undefined
    ? null
    : validateKpiBinding(status.tone, `${jsonPath}.tone`, data?.fields, errors, "tone");
  if (tone?.field && data?.rows) {
    const cell = lastKpiCell(data, tone.field);
    if (cell && !KPI_TONES.has(cell.value)) {
      addError(errors, "INVALID_KPI_TONE", cell.path, "status tone field must resolve to a supported tone.");
    }
  }
}

function validateKpiReferences(references, jsonPath, errors) {
  if (!Array.isArray(references) || references.length === 0 || references.length > 3) {
    addError(errors, "INVALID_KPI_REFERENCES", jsonPath, "references must contain 1-3 items.");
    return;
  }

  const seen = new Set();
  references.forEach((reference, index) => {
    const referencePath = `${jsonPath}[${index}]`;
    if (!isPlainObject(reference)) {
      addError(errors, "INVALID_KPI_REFERENCE", referencePath, "reference must be an object.");
      return;
    }
    validateOwnKeys(reference, new Set(["ref", "label"]), referencePath, errors);
    if (
      typeof reference.ref !== "string" ||
      reference.ref.length === 0 ||
      reference.ref.trim() !== reference.ref ||
      reference.ref.length > 16_384 ||
      !KPI_WIKI_REF_PATTERN.test(reference.ref)
    ) {
      addError(
        errors,
        "INVALID_KPI_REFERENCE_REF",
        `${referencePath}.ref`,
        "ref must be a version-pinned kb-wiki://wiki/.../versions/.../files/... citation copied from the current Wiki finalize result.",
      );
    } else if (seen.has(reference.ref)) {
      addError(errors, "DUPLICATE_KPI_REFERENCE", `${referencePath}.ref`, "refs must be unique within one KPI item.");
    } else {
      seen.add(reference.ref);
    }
    validateDisplayString(reference.label, `${referencePath}.label`, 120, errors);
  });
}

function validateKpiDatasets(datasets, errors) {
  const result = new Map();
  if (datasets === undefined) return result;
  if (!isPlainObject(datasets) || Object.keys(datasets).length === 0) {
    addError(errors, "INVALID_KPI_DATASETS", "$.datasets", "datasets must be a non-empty object of named datasets.");
    return result;
  }
  for (const [name, value] of Object.entries(datasets)) {
    const datasetPath = propertyPath("$.datasets", name);
    if (!KPI_ID_PATTERN.test(name)) {
      addError(errors, "INVALID_KPI_DATASET_ID", datasetPath, "dataset names must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$.");
      continue;
    }
    result.set(name, validateKpiData(value, errors, datasetPath));
  }
  return result;
}

function validateKpiEnvelope(envelope, errors) {
  validateOwnKeys(envelope, new Set(["version", "renderer", "data", "datasets", "spec"]), "$", errors);
  const defaultData = envelope.data === undefined ? null : validateKpiData(envelope.data, errors, "$.data");
  const datasets = validateKpiDatasets(envelope.datasets, errors);
  if (envelope.data === undefined && envelope.datasets === undefined) {
    addError(errors, "MISSING_KPI_DATA", "$", "kpi requires default data, named datasets, or both.");
  }
  if (!isPlainObject(envelope.spec)) {
    addError(errors, "INVALID_KPI_SPEC", "$.spec", "kpi spec must be an object.");
    return;
  }
  validateOwnKeys(envelope.spec, new Set(["timeField", "items"]), "$.spec", errors);
  const commonTimeField = envelope.spec.timeField === undefined
    ? null
    : validateKpiField(envelope.spec.timeField, "$.spec.timeField", null, errors);
  const items = envelope.spec.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 12) {
    addError(errors, "INVALID_KPI_ITEMS", "$.spec.items", "items must contain 1-12 KPI items.");
    return;
  }

  const selectedDatasets = new Set();
  const seenIds = new Set();
  items.forEach((item, index) => {
    const itemPath = `$.spec.items[${index}]`;
    if (!isPlainObject(item)) {
      addError(errors, "INVALID_KPI_ITEM", itemPath, "KPI item must be an object.");
      return;
    }
    validateOwnKeys(
      item,
      new Set(["id", "title", "dataset", "value", "status", "trend", "references"]),
      itemPath,
      errors,
    );
    let data = defaultData;
    if (item.dataset !== undefined) {
      if (typeof item.dataset !== "string" || !KPI_ID_PATTERN.test(item.dataset)) {
        addError(errors, "INVALID_KPI_DATASET_ID", `${itemPath}.dataset`, "dataset must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$.");
        data = null;
      } else if (!datasets.has(item.dataset)) {
        addError(errors, "MISSING_KPI_DATASET", `${itemPath}.dataset`, `dataset ${JSON.stringify(item.dataset)} is not defined in $.datasets.`);
        data = null;
      } else {
        data = datasets.get(item.dataset);
      }
    } else if (!defaultData) {
      addError(errors, "MISSING_KPI_DEFAULT_DATA", itemPath, "an item without dataset requires top-level data.");
    }
    if (data) selectedDatasets.add(data);

    if (typeof item.id !== "string" || !KPI_ID_PATTERN.test(item.id)) {
      addError(errors, "INVALID_KPI_ID", `${itemPath}.id`, "id must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$.");
    } else if (seenIds.has(item.id)) {
      addError(errors, "DUPLICATE_KPI_ID", `${itemPath}.id`, "KPI item ids must be unique.");
    } else {
      seenIds.add(item.id);
    }
    validateDisplayString(item.title, `${itemPath}.title`, 120, errors);
    let valueField = null;
    let valueFormat = null;
    if (!isPlainObject(item.value)) {
      addError(errors, "INVALID_KPI_VALUE", `${itemPath}.value`, "value must bind a selected dataset field.");
    } else {
      validateOwnKeys(item.value, new Set(["field", "reduce", "format"]), `${itemPath}.value`, errors);
      valueField = validateKpiField(item.value.field, `${itemPath}.value.field`, data?.fields, errors);
      if (item.value.reduce !== undefined && item.value.reduce !== "lastNonNull") {
        addError(errors, "INVALID_KPI_REDUCE", `${itemPath}.value.reduce`, "reduce must be lastNonNull.");
      }
      valueFormat = validateKpiFormat(item.value.format, `${itemPath}.value.format`, errors);
      if (valueField && valueFormat && valueFormat.style !== "text" && data?.rows) {
        const current = lastKpiCell(data, valueField);
        if (current && typeof current.value !== "number") {
          addError(errors, "NON_NUMERIC_KPI_VALUE", current.path, "numeric KPI formats require a number at the reduced value.");
        }
      }
    }
    if (item.status !== undefined) validateKpiStatus(item.status, `${itemPath}.status`, data, errors);
    if (item.trend !== undefined) {
      const trendPath = `${itemPath}.trend`;
      if (!isPlainObject(item.trend)) {
        addError(errors, "INVALID_KPI_TREND", trendPath, "trend must be an object.");
      } else {
        validateOwnKeys(item.trend, new Set(["type", "field", "timeField", "compare", "yScale"]), trendPath, errors);
        if (!KPI_TREND_TYPES.has(item.trend.type)) {
          addError(errors, "INVALID_KPI_TREND_TYPE", `${trendPath}.type`, "trend type must be line or area.");
        }
        const trendField = item.trend.field === undefined
          ? valueField
          : validateKpiField(item.trend.field, `${trendPath}.field`, data?.fields, errors);
        const timeField = item.trend.timeField === undefined
          ? commonTimeField && validateKpiField(commonTimeField, "$.spec.timeField", data?.fields, errors)
          : validateKpiField(item.trend.timeField, `${trendPath}.timeField`, data?.fields, errors);
        const hasTimeFieldBinding = item.trend.timeField !== undefined || envelope.spec.timeField !== undefined;
        if (!timeField && !hasTimeFieldBinding) {
          addError(errors, "MISSING_KPI_TIME_FIELD", trendPath, "trend requires spec.timeField or trend.timeField.");
        }
        if (data?.rows?.length > MAX_KPI_TREND_POINTS) {
          addError(errors, "KPI_TREND_LIMIT", `${data.path}.source`, `trend source exceeds ${MAX_KPI_TREND_POINTS} points.`);
        }
        if (trendField && data?.rows) {
          data.rows.forEach((row, rowIndex) => {
            const cell = kpiCell(data, row, rowIndex, trendField);
            if (cell.value !== null && cell.value !== undefined && typeof cell.value !== "number") {
              addError(errors, "NON_NUMERIC_KPI_TREND", cell.path, "trend fields may contain only numbers or null.");
            }
          });
        }
        if (item.trend.compare !== undefined) {
          const comparePath = `${trendPath}.compare`;
          if (!isPlainObject(item.trend.compare)) {
            addError(errors, "INVALID_KPI_COMPARE", comparePath, "compare must be an object.");
          } else {
            validateOwnKeys(item.trend.compare, new Set(["lag", "mode", "label", "polarity"]), comparePath, errors);
            if (!Number.isInteger(item.trend.compare.lag) || item.trend.compare.lag < 1 || item.trend.compare.lag > 10_000) {
              addError(errors, "INVALID_KPI_COMPARE_LAG", `${comparePath}.lag`, "lag must be an integer between 1 and 10000.");
            }
            if (!KPI_COMPARE_MODES.has(item.trend.compare.mode)) {
              addError(errors, "INVALID_KPI_COMPARE_MODE", `${comparePath}.mode`, "compare mode must be absolute or relative.");
            }
            if (item.trend.compare.label !== undefined) validateDisplayString(item.trend.compare.label, `${comparePath}.label`, 120, errors);
            if (item.trend.compare.polarity !== undefined && !KPI_POLARITIES.has(item.trend.compare.polarity)) {
              addError(errors, "INVALID_KPI_POLARITY", `${comparePath}.polarity`, "polarity is not supported.");
            }
          }
        }
        if (item.trend.yScale !== undefined) {
          const scalePath = `${trendPath}.yScale`;
          if (!isPlainObject(item.trend.yScale)) {
            addError(errors, "INVALID_KPI_Y_SCALE", scalePath, "yScale must be an object.");
          } else {
            validateOwnKeys(item.trend.yScale, new Set(["includeZero"]), scalePath, errors);
            if (item.trend.yScale.includeZero !== undefined && typeof item.trend.yScale.includeZero !== "boolean") {
              addError(errors, "INVALID_KPI_Y_SCALE", `${scalePath}.includeZero`, "includeZero must be a boolean.");
            }
          }
        }
      }
    }
    if (item.references !== undefined) validateKpiReferences(item.references, `${itemPath}.references`, errors);
  });

  const totalRows = [...selectedDatasets].reduce((total, data) => total + data.rowCount, 0);
  const totalCells = [...selectedDatasets].reduce((total, data) => total + data.cellCount, 0);
  if (totalRows > MAX_KPI_ROWS) {
    addError(errors, "KPI_DATA_LIMIT", "$", `selected KPI datasets exceed ${MAX_KPI_ROWS} total rows.`);
  }
  if (totalCells > MAX_KPI_CELLS) {
    addError(errors, "KPI_DATA_LIMIT", "$", `selected KPI datasets exceed ${MAX_KPI_CELLS} total cells.`);
  }
}

function validateEchartsEnvelope(envelope, errors) {
  if (Object.hasOwn(envelope, "datasets")) {
    addError(errors, "UNSUPPORTED_DATASETS", "$.datasets", "the ECharts renderer accepts only top-level data.");
  }
  let dimensions = null;
  if (!isPlainObject(envelope.data)) {
    addError(errors, "INVALID_DATA", "$.data", "data must be a JSON object.");
  } else {
    const shape = envelope.data.shape ?? "table";
    if (shape === "table") {
      dimensions = validateDimensions(envelope.data.dimensions, errors);
      if (envelope.data.kind === "inline") {
        validateInlineData(envelope.data, dimensions, errors);
      } else if (envelope.data.kind === "ref") {
        validateRefData(envelope.data, errors);
      } else {
        addError(errors, "INVALID_DATA_KIND", "$.data.kind", "data.kind must be inline or ref.");
      }
      validateSpec(envelope.spec, dimensions, errors);
      return;
    }
    if (shape !== "graph" && shape !== "hierarchy") {
      addError(errors, "INVALID_DATA_SHAPE", "$.data.shape", "shape must be table, graph, or hierarchy.");
      return;
    }
    if (Object.hasOwn(envelope.data, "dimensions")) {
      addError(errors, "STRUCTURED_DIMENSIONS", "$.data.dimensions", `${shape} data cannot declare dimensions.`);
    }
    let source = null;
    if (envelope.data.kind === "inline") {
      validateOwnKeys(envelope.data, new Set(["kind", "shape", "source"]), "$.data", errors);
      source = shape === "graph"
        ? validateGraphSource(envelope.data.source, errors)
        : validateHierarchySource(envelope.data.source, errors);
    } else if (envelope.data.kind === "ref") {
      validateStructuredRefData(envelope.data, shape, errors);
    } else {
      addError(errors, "INVALID_DATA_KIND", "$.data.kind", "data.kind must be inline or ref.");
    }
    validateStructuredSpec(envelope.spec, shape, source, errors);
    return;
  }
  validateSpec(envelope.spec, dimensions, errors);
}

export function validateEnvelope(envelope) {
  const errors = [];
  if (!isPlainObject(envelope)) {
    addError(errors, "INVALID_ENVELOPE", "$", "chart envelope must be a JSON object.");
    return errors;
  }

  scanObjectKeys(envelope, "$", errors);
  if (envelope.version !== 1) {
    addError(errors, "INVALID_VERSION", "$.version", "version must equal 1.");
  }
  if (envelope.renderer === "echarts") {
    validateEchartsEnvelope(envelope, errors);
  } else if (envelope.renderer === "kpi") {
    validateKpiEnvelope(envelope, errors);
  } else if (envelope.renderer === "table") {
    validateTableEnvelope(envelope, errors);
  } else {
    addError(errors, "INVALID_RENDERER", "$.renderer", "renderer must equal table, echarts, or kpi.");
    if (!isPlainObject(envelope.data)) {
      addError(errors, "INVALID_DATA", "$.data", "data must be a JSON object.");
    }
  }
  return errors;
}

function validateFile(filePath, index) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`input ${index} must be a regular non-symlink file`);
  }
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error(`input ${index} exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return validateEnvelope(envelope);
}

function emit(payload, exitCode) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = exitCode;
}

function main(argv) {
  if (argv.length === 0 || argv.length > MAX_FILES) {
    emit(
      {
        schema_version: SCHEMA_VERSION,
        ok: false,
        errors: [{ code: "INVALID_ARGUMENTS", path: "$", message: `provide 1-${MAX_FILES} JSON files` }],
      },
      2,
    );
    return;
  }

  const results = [];
  for (let index = 0; index < argv.length; index += 1) {
    try {
      results.push({ index: index + 1, errors: validateFile(argv[index], index + 1) });
    } catch (error) {
      results.push({
        index: index + 1,
        errors: [{
          code: error instanceof SyntaxError ? "INVALID_JSON" : "INVALID_INPUT_FILE",
          path: "$",
          message: error instanceof SyntaxError ? "input is not valid JSON" : String(error.message),
        }],
      });
    }
  }

  const errors = results.flatMap((result) =>
    result.errors.map((error) => ({ input: result.index, ...error })),
  );
  emit(
    errors.length === 0
      ? { schema_version: SCHEMA_VERSION, ok: true, validated: results.length }
      : { schema_version: SCHEMA_VERSION, ok: false, errors },
    errors.length === 0 ? 0 : 1,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
