import { z } from "zod";
import type { Plan, ActionParams, AppState, SelectedAction, PlanArgs } from "../ia/types.js";
import { LoginActions, PopupActions, WindowActions, CommonActions } from "../ia/actions.js";

/**
 * Login plan params
 */
export interface LoginParams extends ActionParams {
  newAccount?: boolean;
}

const loginParamsSchema = z.object({
  newAccount: z.boolean().default(false),
});

/**
 * Login Plan
 *
 * Navigates the WeChat login flow from any state to logged-in state.
 *
 * States handled:
 * - login_qr: Wait for QR code scan
 * - login_account: Click "Log In" or "Switch Account"
 * - login_phone_confirm: Wait for phone confirmation (notify client)
 * - login_loading: Wait for app to load
 * - chat: Already logged in (goal reached)
 * - popup: Dismiss any popup dialogs
 */
export const loginPlan: Plan<LoginParams> = {
  id: "login",
  description: "Log into WeChat",
  params: loginParamsSchema,

  isGoalReached: ({ state }: { state: AppState }) => {
    // Goal: chat view with no popup
    return state.mainWindow.view === "chat" && state.popup === null;
  },

  selectAction: ({ state, params, identified }: PlanArgs<LoginParams>): SelectedAction | null => {
    // Rule 1: Always dismiss popups first (use popup frame)
    if (state.popup !== null && identified.popup) {
      return {
        action: PopupActions.DISMISS,
        metadata: identified.popup.metadata,
      };
    }

    // Get main window metadata for all main window actions
    const mainMeta = identified.mainWindow?.metadata;

    // Rule 2: Based on main window state
    switch (state.mainWindow.view) {
      case "login_qr":
        // Wait for QR code scan (effect watcher emits QR)
        return { action: CommonActions.WAIT, metadata: mainMeta };

      case "login_account":
        // Choose between existing account or new account
        return {
          action: params.newAccount ? LoginActions.CLICK_SWITCH_ACCOUNT : LoginActions.CLICK_LOGIN,
          metadata: mainMeta,
        };

      case "login_phone_confirm":
        // Wait for phone confirmation (effect watcher emits once on state entry)
        return { action: CommonActions.WAIT, metadata: mainMeta };

      case "login_loading":
        // Wait for app to load
        return { action: CommonActions.WAIT, metadata: mainMeta };

      case "chat":
        // Wait for UI to settle, then maximize window
        return {
          action: {
            type: "sequence",
            actions: [
              CommonActions.WAIT_LONG,
              WindowActions.MAXIMIZE,
            ],
          },
          metadata: mainMeta,
        };

      default:
        // Unknown state
        return null;
    }
  },
};
