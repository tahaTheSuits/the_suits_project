import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  items: [],
  dailyReports: [],
};

export const inventorySlice = createSlice({
  name: "inventory",
  initialState,
  reducers: {
    setInventory: (state, action) => {
      state.items = action.payload;
    },
    // Replaces one product row (e.g. the row returned by a PATCH) so every
    // view sees the change before the next full reload.
    upsertInventoryItem: (state, action) => {
      const row = action.payload;
      if (!row?._id) return;
      const index = state.items.findIndex((item) => String(item._id) === String(row._id));
      if (index === -1) state.items.push(row);
      else state.items[index] = { ...state.items[index], ...row };
    },
    setDailyReport: (state, action) => {
      state.dailyReports = action.payload;
    },
  },
});

export const { setInventory, upsertInventoryItem, setDailyReport } = inventorySlice.actions;
export default inventorySlice.reducer;