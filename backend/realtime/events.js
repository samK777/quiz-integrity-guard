let socketServer = null;

function setSocketServer(server) {
    socketServer = server;
}

function publishViolationCreated(payload) {
    if (socketServer) socketServer.to("teachers").emit("violation:created", payload);
}

function publishAttemptStarted(payload) {
    if (socketServer) socketServer.to("teachers").emit("attempt:started", payload);
}

function publishAttemptCompleted(payload) {
    if (socketServer) socketServer.to("teachers").emit("attempt:completed", payload);
}

function publishAttemptAutoSubmitted(payload) {
    if (socketServer) socketServer.to("teachers").emit("attempt:auto_submitted", payload);
}

module.exports = {
    setSocketServer,
    publishViolationCreated,
    publishAttemptStarted,
    publishAttemptCompleted,
    publishAttemptAutoSubmitted
};
