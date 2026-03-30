// Fixed mock data - consistent references only
export const mockData = {
  workItems: {
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-6cc0db01": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-6cc0db01",
      title: "When deleting an item, select the next item if there is one",
      status: "not_started",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47",
      },
      rank: 0,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-b8bd3094": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-b8bd3094",
      title: "Tee paremmaksi käyttää mobiililla",
      status: "not_started",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47",
      },
      rank: 1,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-067787de": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-067787de",
      title: "M365copilot + VsCode + Github -devausympäristö",
      status: "not_started",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47",
      },
      rank: 2,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-41b134d8": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-41b134d8",
      title: "Karmea datankorruptointiongelma",
      status: "done",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47",
      },
      rank: 3,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-9b354c76": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-9b354c76",
      title: "DNA Business app GTM harkan synkkaus",
      status: "done",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-58dda4ff": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-b5587ec6",
      },
      rank: 0,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-94622abe": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::wi-94622abe",
      title: "Sparrailua AI collabin käytöstä",
      status: "not_started",
      parentId: null,
      childrenIds: [],
      backlogAssignments: {
        "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-58dda4ff": "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-b5587ec6",
      },
      rank: 1,
    },
  },
  backlogs: {
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-b5587ec6": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-b5587ec6",
      name: "Todo",
      parentId: null,
      childrenIds: [],
      treeId: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-58dda4ff",
      rank: 0,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47",
      name: "Product backlog",
      parentId: null,
      childrenIds: [],
      treeId: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013",
      rank: 0,
    },
  },
  backlogTrees: {
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-4ed93013",
      name: "Agilefant",
      rootBacklogIds: ["227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-c37cbd47"],
      rank: 0,
    },
    "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-58dda4ff": {
      id: "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-58dda4ff",
      name: "Transu office",
      rootBacklogIds: ["227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-b5587ec6"],
      rank: 1,
    },
  },
};
