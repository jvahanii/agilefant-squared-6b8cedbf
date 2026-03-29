// Assuming the existing function structure

// Function to handle adding a child work item
const handleAddChild = (newChild) => {
  // Your existing logic for adding the child
  // Select the newly created child
  selectWorkItem(newChild.id);
  // Keep isAdding state true
  setIsAdding(true);
};

// Update the first onSubmit handler in lines 563-569
const onSubmitHandlerFirst = () => {
  // Logic for submitting the form
  // Replace dispatch shortcut event with:
  handleAddChild(newlyCreatedChild);
};

// Update the second onSubmit handler in lines 578-584
const onSubmitHandlerSecond = () => {
  // Logic for submitting the form for the second context
  // Replace dispatch shortcut event with:
  handleAddChild(newlyCreatedChild);
};