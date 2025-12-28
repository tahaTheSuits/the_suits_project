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
    setDailyReport: (state, action) => {
      state.dailyReports = action.payload;
    },
  },
});

export const { setInventory, setDailyReport } = inventorySlice.actions;
export default inventorySlice.reducer;