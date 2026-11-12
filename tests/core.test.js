import test from "node:test";
import assert from "node:assert/strict";
import {
  localDateString,validDate,calculateQuote,calculateDashboard,
  normalizeUKPhone,validateBackup,advanceRepeat,migrateLead,migrateQuote
} from "../core.js";

test("local date formatter uses local calendar components",()=>{
  const d=new Date(2026,0,2,23,30);
  assert.equal(localDateString(d),"2026-01-02");
});
test("date validation rejects impossible dates",()=>{
  assert.equal(validDate("2024-02-29",false),true);
  assert.equal(validDate("2025-02-29",false),false);
});
test("quote subtotal, discount, VAT and total are calculated and rounded",()=>{
  assert.deepEqual(calculateQuote([{description:"Labour",qty:2,price:45},{description:"Materials",qty:1,price:30}],10,20),
    {items:[{description:"Labour",qty:2,price:45},{description:"Materials",qty:1,price:30}],discount:10,vat:20,subtotal:120,discountAmount:12,vatAmount:21.6,total:129.6});
});
test("quote validation rejects invalid rows and percentages",()=>{
  assert.throws(()=>calculateQuote([{description:"",qty:1,price:2}],0,0));
  assert.throws(()=>calculateQuote([{description:"x",qty:-1,price:2}],0,0));
  assert.throws(()=>calculateQuote([{description:"x",qty:1,price:2}],101,0));
});
test("dashboard defines conversion as won / (won + lost)",()=>{
  const base={created:"2026-01-01",job:"job",name:"A",quote:null,followUpDate:"",nextRepeat:""};
  const d=calculateDashboard([
    {...base,id:"1",stage:"Won",quote:{items:[{description:"job",qty:1,price:100}],discount:0,vat:0}},
    {...base,id:"2",stage:"Lost"},
    {...base,id:"3",stage:"New enquiry",followUpDate:"2026-01-01"}
  ],"2026-01-02");
  assert.equal(d.conversionRate,50);assert.equal(d.enquiries,3);assert.equal(d.followUpsDue,1);assert.equal(d.wonValue,100);
});
test("UK mobile numbers normalize for WhatsApp",()=>{
  assert.equal(normalizeUKPhone("07123 456789"),"447123456789");
  assert.equal(normalizeUKPhone("+44 7123 456789"),"447123456789");
  assert.equal(normalizeUKPhone("+44 (0) 7123 456789"),"447123456789");
  assert.equal(normalizeUKPhone("0044 7123 456789"),"447123456789");
  assert.equal(normalizeUKPhone("123"),null);
});
test("backup is fully validated; invalid data rejected",()=>{
  const lead={id:"a",name:"A",job:"Clean",stage:"New enquiry",created:"2026-01-01",
    phone:"",email:"",source:"",followUpDate:"",nextRepeat:"",repeatInterval:"",preparedMessage:""};
  const b={format:"leadloop-uk-backup",version:2,leads:[lead],settings:[]};
  assert.equal(validateBackup(b).leads.length,1);
  assert.throws(()=>validateBackup({...b,leads:[{...lead,stage:"bogus"}]}));
  assert.throws(()=>validateBackup({...b,leads:[lead,lead]}));
});
test("backup version 1 migrates to version 2",()=>{
  const oldLead={id:"a",customerName:"A",jobDetails:"Clean",phoneNumber:"07123 456789",enquiryDate:"2026-01-01",followupDate:"2026-01-02",nextBooking:"2026-02-01",interval:"monthly",status:"quoted",quotation:{ref:"Q1",quoteDate:"2026-01-01",lines:[{name:"Labour",quantity:2,unitPrice:45}],discount:10,vat:20}};
  const b={format:"leadloop-uk-backup",version:1,leads:[oldLead],settings:{businessName:"Biz"}};
  const clean=validateBackup(b);
  assert.equal(clean.version,2);
  assert.equal(clean.leads[0].name,"A");
  assert.equal(clean.leads[0].followUpDate,"2026-01-02");
  assert.equal(clean.leads[0].quote.reference,"Q1");
  assert.equal(clean.leads[0].quote.total,97.2);
  assert.deepEqual(clean.settings,[{key:"business",value:"Biz"}]);
});
test("repeat booking date advancement clamps end of month",()=>{
  assert.equal(advanceRepeat("2026-01-31","monthly"),"2026-02-28");
  assert.equal(advanceRepeat("2024-01-31","monthly"),"2024-02-29");
  assert.equal(advanceRepeat("2026-02-28","monthly"),"2026-03-28");
  assert.equal(advanceRepeat("2026-03-31","monthly"),"2026-04-30");
  assert.equal(advanceRepeat("2026-01-31","quarterly"),"2026-04-30");
  assert.equal(advanceRepeat("2026-01-31","yearly"),"2027-01-31");
  assert.equal(advanceRepeat("2024-02-29","yearly"),"2025-02-28");
  assert.equal(advanceRepeat("2023-02-28","yearly"),"2024-02-28");
  assert.equal(advanceRepeat("2026-12-31","monthly"),"2027-01-31");
  assert.equal(advanceRepeat("2026-01-15","weekly"),"2026-01-22");
  assert.equal(advanceRepeat("2026-01-15","fortnightly"),"2026-01-29");
  assert.equal(advanceRepeat("","monthly"),"");
  assert.equal(advanceRepeat("2026-01-31","none"),"");
});
test("migration converts legacy lead and quote fields",()=>{
  const old={id:"1",customerName:"A",jobDetails:"Clean",phoneNumber:"07123 456789",enquiryDate:"2026-01-01",followupDate:"2026-01-02",nextBooking:"2026-02-01",interval:"monthly",status:"quoted",quotation:{ref:"Q1",quoteDate:"2026-01-01",lines:[{name:"Labour",quantity:2,unitPrice:45}],discount:10,vat:20}};
  const m=migrateLead(old);
  assert.equal(m.id,"1");
  assert.equal(m.name,"A");
  assert.equal(m.job,"Clean");
  assert.equal(m.phone,"07123 456789");
  assert.equal(m.followUpDate,"2026-01-02");
  assert.equal(m.nextRepeat,"2026-02-01");
  assert.equal(m.repeatInterval,"monthly");
  assert.equal(m.stage,"Quotation prepared");
  assert.equal(m.quote.reference,"Q1");
  assert.equal(m.quote.items[0].description,"Labour");
  assert.equal(m.quote.items[0].qty,2);
  assert.equal(m.quote.items[0].price,45);
  assert.equal(m.quote.total,97.2);
});
test("migration quote helper returns undefined for empty items",()=>{
  assert.equal(migrateQuote({items:[]}),undefined);
});