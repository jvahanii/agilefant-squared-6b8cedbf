// Updated deleteWorkItem and deleteBacklog methods to be synchronous.

// type signature changes in AppState interface

export interface AppState {
    // other properties...
    deleteWorkItem: void;
    deleteBacklog: void;
}

// Update deleteWorkItem
export const deleteWorkItem = (id: string): void => {
    // Fire DB call for deletion without awaiting
    db.deleteWorkItem(id);
    // Update state immediately
    setState(prevState => ({
        ...prevState,
        workItems: prevState.workItems.filter(item => item.id !== id)
    }));
};

// Update deleteBacklog
export const deleteBacklog = (id: string): void => {
    // Fire DB call for deletion without awaiting
    db.deleteBacklog(id);
    // Update state immediately
    setState(prevState => ({
        ...prevState,
        backlogs: prevState.backlogs.filter(backlog => backlog.id !== id)
    }));
};