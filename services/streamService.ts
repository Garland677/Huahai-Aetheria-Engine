export const StreamBus = new EventTarget();

export const activeStreams = new Map<string, string>();

export const updateStream = (logId: string, content: string) => {
    activeStreams.set(logId, content);
    StreamBus.dispatchEvent(new CustomEvent(`stream-${logId}`, { detail: content }));
};

export const finishStream = (logId: string) => {
    activeStreams.delete(logId);
};
