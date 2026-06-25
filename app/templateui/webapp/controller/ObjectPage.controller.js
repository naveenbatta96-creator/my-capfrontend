sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment"
], function (Controller, History, MessageBox, MessageToast, Fragment) {
    "use strict";

    return Controller.extend("com.template.builder.controller.ObjectPage", {

        // ==========================================
        // FORMATTERS
        // ==========================================

        formatLevelState: function (sLevelName) {
            return { "Batch": "Information", "BatchItem": "Success", "CLEARING": "Warning" }[sLevelName] || "None";
        },

        formatLevelText: function (sLevelName) {
            return { "Batch": "Batch", "BatchItem": "BatchItem", "CLEARING": "Clearing" }[sLevelName] || sLevelName;
        },

        formatTemplateID: function (sUUID, sTemplateType) {
            if (!sUUID) return "";
            var sHexPart = sUUID.substring(sUUID.length - 6).toUpperCase();
            var sSuffix = "TEMPLATE";
            if (sTemplateType) {
                var sTypeUpper = sTemplateType.toUpperCase();
                if (sTypeUpper === "LOCKBOX") sSuffix = "LBX";
                else if (sTypeUpper.includes("PAYMENT")) sSuffix = "PAY";
                else if (sTypeUpper.includes("CLEARING")) sSuffix = "CLR";
            }
            return sSuffix + "-" + sTemplateType + "-V1-" + sHexPart;
        },

        // ==========================================
        // LIFECYCLE
        // ==========================================

        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RouteObjectPage").attachPatternMatched(this._onObjectMatched, this);

            this.getView().setModel(new sap.ui.model.json.JSONModel({
                mappingsCount: 0,
                totalCount: 0,
                percentValue: 0,
                unmappedFilterPressed: false
            }), "metaModel");

            this.getView().setModel(new sap.ui.model.json.JSONModel({
                isAdmin: false,
                isStandardTemplate: false
            }), "authModel");

            this.getView().setModel(new sap.ui.model.json.JSONModel({
                rules: []
            }), "rulesModel");
        },

        _onObjectMatched: function (oEvent) {
            var sTemplateId = oEvent.getParameter("arguments").templateId;
            var sPath = "/TemplateMaster(" + sTemplateId + ")";
            var oView = this.getView();

            oView.getModel("authModel").setProperty("/isStandardTemplate", false);
            oView.getModel("rulesModel").setProperty("/rules", []);
            oView.getModel("metaModel").setProperty("/unmappedFilterPressed", false);

            var oTable = this.byId("mappingTable");
            if (oTable && oTable.getBinding("items")) oTable.getBinding("items").filter([]);

            oView.bindElement({
                path: sPath,
                parameters: {
                    $select: "ID,templateName,templateType,sheetMode,status,isStandard",
                    $expand: "mappings($expand=field($select=ID,fieldName,levelName,isRequired);$select=ID,apiField,mappingRule,ruleId,ruleName,sequenceNo)"
                },
                events: {
                    dataReceived: function (oEvt) {
                        var oData = oEvt.getParameter("data");
                        if (!oData) return;
                        oView.getModel("authModel").setProperty("/isStandardTemplate", !!oData.isStandard);

                        // OData V4: Wait for table to finish updating with new data
                        var oTable = this.byId("mappingTable");
                        if (oTable) {
                            oTable.attachEventOnce("updateFinished", this._onTableUpdateAfterAutoMap, this);
                        } else {
                            setTimeout(function () {
                                this._syncRulesAfterTableUpdate();
                                this._updateMappingStats();
                                MessageToast.show("Standard mappings applied successfully!");
                            }.bind(this), 300);
                        }
                    }.bind(this)
                }
            });
        },

        // Waits for table updateFinished then syncs rules — reliable alternative to setTimeout
        // _syncRulesAfterTableUpdate: function () {
        //     var oTable = this.byId("mappingTable");
        //     if (!oTable) return;
        //     var oBinding = oTable.getBinding("items");
        //     if (oBinding) {
        //         oTable.attachEventOnce("updateFinished", function () {
        //             this._syncRulesFromMappings();
        //         }.bind(this));
        //     } else {
        //         // Binding not ready yet — small fallback
        //         setTimeout(this._syncRulesFromMappings.bind(this), 300);
        //     }
        // },
        _syncRulesAfterTableUpdate: function () {
            var oTable = this.byId("mappingTable");
            if (!oTable) {
                setTimeout(this._syncRulesFromMappings.bind(this), 100);
                return;
            }

            // Check if table already has items (event may have already fired)
            var aItems = oTable.getItems();
            if (aItems && aItems.length > 0) {
                // Table already has items, sync immediately
                this._syncRulesFromMappings();
            } else {
                // Table doesn't have items yet, wait for updateFinished
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oTable.attachEventOnce("updateFinished", function () {
                        this._syncRulesFromMappings();
                    }.bind(this));
                } else {
                    // No binding yet, use setTimeout fallback
                    setTimeout(this._syncRulesFromMappings.bind(this), 300);
                }
            }
        },

        // ==========================================
        // AUTH HELPER
        // ==========================================

        _isEditAllowed: function () {
            var oAuth = this.getView().getModel("authModel");
            return !oAuth.getProperty("/isStandardTemplate") || oAuth.getProperty("/isAdmin");
        },

        // ==========================================
        // MAPPING STATS
        // ==========================================

        _updateMappingStats: function () {
            var oTable = this.byId("mappingTable");
            if (!oTable) return;
            var aItems = oTable.getItems();
            var iTotalCount = aItems.length;
            var iMappedCount = 0;
            aItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (oContext) {
                    var sApiField = oContext.getProperty("apiField");
                    if (sApiField && sApiField !== "") iMappedCount++;
                }
            });
            var oMetaModel = this.getView().getModel("metaModel");
            oMetaModel.setProperty("/mappingsCount", iMappedCount);
            oMetaModel.setProperty("/totalCount", iTotalCount);
            oMetaModel.setProperty("/percentValue",
                iTotalCount > 0 ? Math.round((iMappedCount / iTotalCount) * 100) : 0);
        },

        onMappingPropertyChange: function (oEvent) {
            if (!this._isEditAllowed()) {
                var oSource = oEvent.getSource();
                var oKeyBinding = oSource.getBinding("selectedKey");
                if (oKeyBinding) oKeyBinding.resetChanges();
                MessageToast.show("Standard templates cannot be modified.");
                return;
            }
            this._updateMappingStats();
        },

        // ==========================================
        // TOOLBAR ACTIONS
        // ==========================================

        onAutoMapStandard: function () {
            if (!this._isEditAllowed()) { MessageToast.show("Standard templates cannot be modified."); return; }
            var oView = this.getView();
            var oTemplateCtx = oView.getBindingContext();
            if (!oTemplateCtx) return;

            // Capture BEFORE async calls
            var sTemplateId = oTemplateCtx.getProperty("ID");
            var sPath = oTemplateCtx.getPath();

            MessageBox.confirm("This will overwrite current mappings with the Standard Template mappings. Continue?", {
                title: "Auto Map Standard",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;
                    sap.ui.core.BusyIndicator.show(0);
                    var oODataModel = oView.getModel();
                    var oActionBinding = oODataModel.bindContext("/autoMapStandard(...)");
                    oActionBinding.setParameter("targetTemplateId", sTemplateId);

                    oActionBinding.execute().then(function () {
                        sap.ui.core.BusyIndicator.hide();
                        // Re-bind fresh instead of requestRefresh
                        oView.bindElement({
                            path: sPath,
                            parameters: {
                                $select: "ID,templateName,templateType,sheetMode,status,isStandard",
                                $expand: "mappings($expand=field($select=ID,fieldName,levelName,isRequired);$select=ID,apiField,mappingRule,ruleId,ruleName,sequenceNo)"
                            },
                            events: {
                                dataReceived: function (oEvt) {
                                    var oData = oEvt.getParameter("data");
                                    if (!oData) return;
                                    oView.getModel("authModel").setProperty("/isStandardTemplate", !!oData.isStandard);
                                    this._syncRulesAfterTableUpdate();
                                    this._updateMappingStats();
                                    MessageToast.show("Standard mappings applied successfully!");
                                }.bind(this)
                            }
                        });
                    }.bind(this)).catch(function (oError) {
                        sap.ui.core.BusyIndicator.hide();
                        MessageBox.error(oError.message || "Failed to apply standard mappings.", { title: "Auto Map Failed" });
                    });
                }.bind(this)
            });
        },

        onAutoMapAI: function () {
            if (!this._isEditAllowed()) { MessageToast.show("Standard templates cannot be modified."); return; }
            var oView = this.getView();
            var oTemplateCtx = oView.getBindingContext();
            if (!oTemplateCtx) return;
            var sTemplateId = oTemplateCtx.getProperty("ID");
            var oODataModel = oView.getModel();
            var oActionBinding = oODataModel.bindContext("/autoMapAI(...)");
            oActionBinding.setParameter("templateId", sTemplateId);
            sap.ui.core.BusyIndicator.show(0);
            oActionBinding.execute()
                .then(function () {
                    sap.ui.core.BusyIndicator.hide();
                    return oTemplateCtx.requestRefresh();
                })
                .then(function () {
                    this._syncRulesAfterTableUpdate();
                    this._updateMappingStats();
                    MessageToast.show("AI mapping complete!");
                }.bind(this))
                .catch(function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error(oError.message || "AI mapping failed.");
                });
        },

        onClearAllMappings: function () {
            if (!this._isEditAllowed()) { MessageToast.show("Standard templates cannot be modified."); return; }
            var oTable = this.byId("mappingTable");
            if (!oTable) return;
            MessageBox.confirm("Are you sure you want to clear all current mapping rules?", {
                title: "Clear Mappings",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        oTable.getItems().forEach(function (oItem) {
                            var oContext = oItem.getBindingContext();
                            if (oContext) {
                                oContext.setProperty("apiField", "");
                                oContext.setProperty("mappingRule", "");
                                oContext.setProperty("ruleId", "");
                                oContext.setProperty("ruleName", "");
                            }
                        });
                        this.getView().getModel("rulesModel").setProperty("/rules", []);
                        this._updateMappingStats();
                        MessageToast.show("All mapping rules cleared.");
                    }
                }.bind(this)
            });
        },

        onToggleUnmappedFilter: function (oEvent) {
            var bPressed = oEvent.getParameter("pressed");
            var oTable = this.byId("mappingTable");
            if (!oTable) return;
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;
            var aFilters = [];
            if (bPressed) {
                aFilters.push(new sap.ui.model.Filter({
                    filters: [
                        new sap.ui.model.Filter("apiField", sap.ui.model.FilterOperator.EQ, ""),
                        new sap.ui.model.Filter("apiField", sap.ui.model.FilterOperator.EQ, null)
                    ],
                    and: false
                }));
            }
            oBinding.filter(aFilters);
        },

        // ==========================================
        // MAPPING RULES
        // ==========================================

        // _syncRulesFromMappings: function () {
        //     var oTable = this.byId("mappingTable");
        //     if (!oTable) return;
        //     var oRulesModel = this.getView().getModel("rulesModel");
        //     if (!oRulesModel) return;
        //     var oSeen = {};
        //     var aRules = [];
        //     oTable.getItems().forEach(function (oItem) {
        //         var oContext = oItem.getBindingContext();
        //         if (oContext) {
        //             var sRuleId = oContext.getProperty("ruleId");
        //             var sRuleName = oContext.getProperty("ruleName");
        //             if (sRuleId && !oSeen[sRuleId]) {
        //                 oSeen[sRuleId] = true;
        //                 aRules.push({ sequence: aRules.length + 1, ruleId: sRuleId, ruleName: sRuleName || sRuleId });
        //             }
        //         }
        //     });
        //     oRulesModel.setProperty("/rules", aRules);
        //     // Also update stats since table is fully rendered at this point
        //     this._updateMappingStats();
        // },
        _syncRulesFromMappings: function () {
            var oTable = this.byId("mappingTable");
            if (!oTable) return;
            var oRulesModel = this.getView().getModel("rulesModel");
            if (!oRulesModel) return;
            var aRules = [];
            var iSequence = 1;

            // Build rules array from table items (NO deduplication — one per field)
            oTable.getItems().forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (oContext) {
                    var sRuleId = oContext.getProperty("ruleId");
                    var sRuleName = oContext.getProperty("ruleName");
                    var sFieldName = oContext.getProperty("field/fieldName");

                    // Only add if rule ID exists
                    if (sRuleId) {
                        aRules.push({
                            sequence: iSequence++,
                            ruleId: sRuleId,
                            ruleName: sRuleName || sRuleId,
                            sourceField: sFieldName
                        });
                    }
                }
            });

            oRulesModel.setProperty("/rules", aRules);
            this._updateMappingStats();
        },

        onAddRule: async function () {
            try {
                if (!this.oCreateRuleDialog) {
                    this.oCreateRuleDialog = await Fragment.load({
                        id: this.getView().getId(),
                        name: "com.template.builder.fragment.CreateRuleDialog",
                        controller: this
                    });
                    this.getView().addDependent(this.oCreateRuleDialog);
                }
                Fragment.byId(this.getView().getId(), "ruleIdInput").setValue("");
                Fragment.byId(this.getView().getId(), "ruleNameInput").setValue("");
                this.oCreateRuleDialog.open();
            } catch (error) { MessageToast.show("Error loading create rule dialog"); }
        },

        onConfirmCreateRule: function () {
            var sRuleId = Fragment.byId(this.getView().getId(), "ruleIdInput").getValue().trim();
            var sRuleName = Fragment.byId(this.getView().getId(), "ruleNameInput").getValue().trim();
            if (!sRuleId) { MessageToast.show("Please enter a Rule ID"); return; }
            if (!sRuleName) { MessageToast.show("Please enter a Rule Name"); return; }
            var oRulesModel = this.getView().getModel("rulesModel");
            var aRules = oRulesModel.getProperty("/rules");
            aRules.push({ sequence: aRules.length + 1, ruleId: sRuleId, ruleName: sRuleName });
            oRulesModel.setProperty("/rules", aRules);
            MessageToast.show("Rule \"" + sRuleName + "\" added.");
            this.oCreateRuleDialog.close();
        },

        onCloseCreateRuleDialog: function () {
            if (this.oCreateRuleDialog) this.oCreateRuleDialog.close();
        },

        onDeleteRule: function (oEvent) {
            var oItem = oEvent.getSource().getParent().getParent();
            var oContext = oItem.getBindingContext("rulesModel");
            var iIndex = parseInt(oContext.getPath().split("/").pop());
            var oRulesModel = this.getView().getModel("rulesModel");
            var aRules = oRulesModel.getProperty("/rules");
            aRules.splice(iIndex, 1);
            aRules.forEach(function (r, i) { r.sequence = i + 1; });
            oRulesModel.setProperty("/rules", aRules);
            MessageToast.show("Rule removed.");
        },

        // ==========================================
        // SOURCE FIELDS — ADD / DELETE
        // ==========================================

        onAddMapping: async function () {
            try {
                if (!this.oAddMappingDialog) {
                    this.oAddMappingDialog = await Fragment.load({
                        id: this.getView().getId(),
                        name: "com.template.builder.fragment.AddMappingDialog",
                        controller: this
                    });
                    this.getView().addDependent(this.oAddMappingDialog);
                }
                this.oAddMappingDialog.open();
            } catch (error) { MessageToast.show("Error loading field selection dialog"); }
        },

        onSearchAddMappingField: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var oBinding = oEvent.getSource().getBinding("items");
            var aFilters = [];
            if (sValue && sValue.trim() !== "") {
                aFilters.push(new sap.ui.model.Filter("fieldName", sap.ui.model.FilterOperator.Contains, sValue));
            }
            oBinding.filter(aFilters);
        },

        onConfirmAddMappingField: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) return;
            var oFieldCtx = oSelectedItem.getBindingContext();
            if (!oFieldCtx) return;
            var sFieldId = oFieldCtx.getProperty("ID");
            var oTemplateCtx = this.getView().getBindingContext();
            if (!oTemplateCtx) return;
            var sTemplateId = oTemplateCtx.getProperty("ID");
            var oTable = this.byId("mappingTable");
            var iNextSeq = oTable ? oTable.getItems().length + 1 : 1;
            var oODataModel = this.getView().getModel();
            sap.ui.core.BusyIndicator.show(0);
            oODataModel.bindList("/TemplateFieldMapping").create({
                template_ID: sTemplateId,
                field_ID: sFieldId,
                sequenceNo: iNextSeq,
                apiField: "",
                mappingRule: "",
                ruleId: ""
            }).created().then(function () {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show("Field added successfully.");
                var oContext = this.getView().getBindingContext();
                if (oContext) oContext.refresh();
            }.bind(this)).catch(function () {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show("Error adding field mapping.");
            });
        },

        onDeleteMapping: function (oEvent) {
            var oItem = oEvent.getSource().getParent().getParent();
            var oContext = oItem.getBindingContext();
            if (!oContext) return;
            MessageBox.confirm("Remove this field mapping?", {
                title: "Confirm Removal",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        sap.ui.core.BusyIndicator.show(0);
                        oContext.delete().then(function () {
                            sap.ui.core.BusyIndicator.hide();
                            MessageToast.show("Field mapping removed.");
                            var oViewContext = this.getView().getBindingContext();
                            if (oViewContext) oViewContext.refresh();
                            this._updateMappingStats();
                        }.bind(this)).catch(function () {
                            sap.ui.core.BusyIndicator.hide();
                            MessageToast.show("Error removing field mapping.");
                        });
                    }
                }.bind(this)
            });
        },
        _onTableUpdateAfterAutoMap: function () {
            this._syncRulesAfterTableUpdate();
            this._updateMappingStats();
            MessageToast.show("Standard mappings applied successfully!");
        },

        // ==========================================
        // FOOTER ACTIONS
        // ==========================================

        onPreviewAPIPayload: async function () {
            try {
                var oTemplateCtx = this.getView().getBindingContext();
                if (!oTemplateCtx) return;
                var oTable = this.byId("mappingTable");
                if (!oTable) return;
                var aMappings = [];
                oTable.getItems().forEach(function (oItem) {
                    var oContext = oItem.getBindingContext();
                    if (oContext) {
                        aMappings.push({
                            sequenceNo: oContext.getProperty("sequenceNo"),
                            sourceField: oContext.getProperty("field/fieldName"),
                            level: oContext.getProperty("field/levelName"),
                            apiField: oContext.getProperty("apiField") || null,
                            mappingRule: oContext.getProperty("mappingRule") || null,
                            ruleId: oContext.getProperty("ruleId") || null,
                            ruleName: oContext.getProperty("ruleName") || null
                        });
                    }
                });
                var oPayload = {
                    templateId: oTemplateCtx.getProperty("ID"),
                    templateName: oTemplateCtx.getProperty("templateName"),
                    templateType: oTemplateCtx.getProperty("templateType"),
                    sheetMode: oTemplateCtx.getProperty("sheetMode") || "SINGLE",
                    mappings: aMappings
                };
                if (!this.oPreviewDialog) {
                    this.oPreviewDialog = await Fragment.load({
                        id: this.getView().getId(),
                        name: "com.template.builder.fragment.PreviewPayloadDialog",
                        controller: this
                    });
                    this.getView().addDependent(this.oPreviewDialog);
                }
                this.oPreviewDialog.open();
                Fragment.byId(this.getView().getId(), "payloadTextArea").setValue(JSON.stringify(oPayload, null, 4));
            } catch (error) { MessageToast.show("Error loading payload preview"); }
        },

        onCopyPayloadToClipboard: function () {
            var oTextArea = Fragment.byId(this.getView().getId(), "payloadTextArea");
            if (oTextArea) {
                navigator.clipboard.writeText(oTextArea.getValue())
                    .then(function () { MessageToast.show("Payload copied to clipboard!"); })
                    .catch(function () { MessageToast.show("Could not copy payload."); });
            }
        },

        onClosePreviewDialog: function () {
            if (this.oPreviewDialog) this.oPreviewDialog.close();
        },

        onValidateMapping: function () {
            var oTable = this.byId("mappingTable");
            if (!oTable) return;
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            var aErrors = [], aWarnings = [];
            oTable.getItems().forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (!oContext) return;
                var sFieldName = oContext.getProperty("field/fieldName");
                var bRequired = oContext.getProperty("field/isRequired");
                var sApiField = oContext.getProperty("apiField");
                if (!sApiField) {
                    if (bRequired) aErrors.push("Required field '" + sFieldName + "' is not mapped.");
                    else aWarnings.push("Optional field '" + sFieldName + "' has no mapping.");
                }
            });
            if (aErrors.length > 0) {
                var sMsg = "Validation Failed:\n\n" + aErrors.join("\n");
                if (aWarnings.length > 0) sMsg += "\n\nWarnings:\n" + aWarnings.join("\n");
                MessageBox.error(sMsg, { title: "Mapping Validation Error" });
            } else if (aWarnings.length > 0) {
                MessageBox.warning("Warnings:\n\n" + aWarnings.join("\n"), { title: "Mapping Validation Warning" });
            } else {
                MessageBox.success("All fields correctly mapped!", { title: "Mapping Validation Success" });
            }
        },

        onSaveChanges: function () {
            var oODataModel = this.getView().getModel();
            sap.ui.core.BusyIndicator.show(0);
            oODataModel.submitBatch(oODataModel.getUpdateGroupId()).then(function () {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show("All changes saved!");
                this._updateMappingStats();
            }.bind(this)).catch(function () {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show("Error saving changes.");
            });
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            if (oHistory.getPreviousHash() !== undefined) window.history.go(-1);
            else this.getOwnerComponent().getRouter().navTo("RouteHome", {}, true);
        }
    });
});