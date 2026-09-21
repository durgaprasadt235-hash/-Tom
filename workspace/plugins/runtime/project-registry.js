const path = require("path");
const { DROP_ROOT } = require("../../agent");

const PROJECTS = Object.freeze({
  drop: Object.freeze({
    id: "drop",
    enterpriseId: "local-enterprise",
    name: "Drop",
    root: path.resolve(DROP_ROOT)
  })
});

function getProject(projectId) {
  if (typeof projectId !== "string") return null;
  return PROJECTS[projectId] || null;
}

function validateProjectId(projectId) {
  return getProject(projectId) !== null;
}

module.exports = { getProject, validateProjectId };
