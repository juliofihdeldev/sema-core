const express = require('express');
const router = express.Router();
const sprintf = require('sprintf-js').sprintf;
// Note: inporting datejs will extend the native Date class
require('datejs');
const semaLog = require(`${__basedir}/seama_services/sema_logger`);
const { PeriodData } = require(`${__basedir}/seama_services/datetime_services`);
const { getMostRecentReceipt, getSalesChannels, getCustomerTypes} = require('../seama_services/sql_services');
const SalesSummary = require('../model_layer/SalesSummary');

/* GET data for sales view. */
const sqlTotalCustomers =
	'SELECT COUNT(*) \
    FROM customer_account \
    WHERE customer_account.kiosk_id = ?';

const sqlTotalRevenue =
	'SELECT SUM(total) \
	FROM receipt \
	WHERE receipt.kiosk_id = ?';

const sqlRevenueByPeriod =
	'SELECT   SUM(total), YEAR(created_at), %s(created_at) \
	FROM      receipt \
	WHERE     kiosk_id=? \
	GROUP BY  YEAR(created_at), %s(created_at) \
	ORDER BY  YEAR(created_at) DESC, %s(created_at) DESC';

const sqlCustomersByPeriod =
	'SELECT   COUNT(id), YEAR(created_at), %s(created_at) \
	FROM      customer_account \
	WHERE     kiosk_id=? \
	GROUP BY  YEAR(created_at), %s(created_at) \
	ORDER BY  YEAR(created_at) DESC, %s(created_at) DESC';

const sqlGallonsPerCustomer =
	'SELECT    SUM(total_gallons), YEAR(created_date), %s(created_date) \
	FROM      receipt \
	WHERE     kiosk_id=?\
	GROUP BY  YEAR(created_date), %s(created_date)\
	ORDER BY  YEAR(created_date) DESC, %s(created_date) DESC';


const sqlRetailerRevenue =
	'SELECT SUM(receipt.customer_amount), YEAR(receipt.created_date), %s(receipt.created_date), \ \
	 receipt.customer_account_id, customer_account.contact_name, customer_account.gps_coordinates \
	FROM receipt \
	INNER JOIN customer_account \
	ON customer_account_id = customer_account.id \
	WHERE receipt.kiosk_id = ? AND receipt.created_date BETWEEN ? AND ? \
	GROUP BY YEAR(receipt.created_date), %s(receipt.created_date), receipt.customer_account_id \
	ORDER BY YEAR(receipt.created_date) DESC, %s(receipt.created_date)  DESC, SUM(receipt.customer_amount) DESC';

const sqlLMostRecentReceipt =
	'SELECT created_date FROM receipt \
	WHERE kiosk_id = ? \
	ORDER BY created_date DESC \
	LIMIT 2';

const sqlLMostRecentCustomer =
	'SELECT created_date FROM customer_amount \
	WHERE kiosk_id = ? \
	ORDER BY created_date DESC \
	LIMIT 2';

router.get('/', async (request, response) => {
	semaLog.info('sema_sales - Enter, kiosk_id:', request.query["site-id"]);

	request.check("site-id", "Parameter site-id is missing").exists();
	request.check("groupby", "Parameter groupby is missing").exists();

	const result = await request.getValidationResult();
	if (!result.isEmpty()) {
		const errors = result.array().map(elem => elem.msg);
		semaLog.error("sema_sales VALIDATION ERROR: ", errors );
		response.status(400).send(errors.toString());
	}else {

		let endDate =null;
		let beginDate = null;
		if( request.query.hasOwnProperty("end-date") || request.query.hasOwnProperty("begin-date")) {
			// If either begin/end date are specified, both must be specified
			if( ! request.query.hasOwnProperty("end-date") || ! request.query.hasOwnProperty("begin-date")) {
				const msg = "sema_sales - Both begin-date AND end-date are required"
				semaLog.error(msg );
				response.status(400).send(msg);
				return;
			}else{
				endDate = new Date(Date.parse(request.query["end-date"]));
				beginDate = new Date(Date.parse(request.query["begin-date"]));
			}
		}

		// Use the most recent receipt as the end date if now is specified (Because there may
		// be many receipts, we don't want the SQL query to span too much tine}
		__pool.getConnection(async (err, connection) => {
			try {
				if (endDate == null) {
					endDate = await getMostRecentReceipt(connection, request.query["site-id"]);
					beginDate = new Date(endDate.getFullYear(), 0);	// 	Default to start of the year
				}
				var salesSummary = new SalesSummary( beginDate, endDate );
				await getTotalCustomers(connection, request.query, salesSummary);
				await getTotalRevenue(connection, request.query, salesSummary);
				await getRevenueByPeriod(connection, request.query, beginDate, endDate, salesSummary);
				// await getGallonsPerCustomer(connection, request.query, results);
				await getCustomersByPeriod(connection, request.query, beginDate, endDate, salesSummary);
				// await getRetailerRevenue(connection, request.query, (endDate) ? endDate : receiptEndDate, results);

				connection.release();
				semaLog.info("Sales exit");
				response.json(salesSummary);
			} catch (err) {
				connection.release();
				return __te(err, response, 500, salesSummary);
			}
		});
	}
});

const getTotalCustomers = (connection, requestParams, results ) => {
	return new Promise((resolve, reject) => {
		connection.query(sqlTotalCustomers, [requestParams["site-id"]], (err, sqlResult ) => {
			if (err) {
				reject(err);
			} else {
				if (Array.isArray(sqlResult) && sqlResult.length >= 1) {
					results.setTotalCustomers(sqlResult[0]["COUNT(*)"]);
				}
				resolve();
			}
		});
	});
};



const getTotalRevenue = (connection, requestParams, results ) => {
	return new Promise((resolve, reject) => {
		connection.query(sqlTotalRevenue, [requestParams["site-id"]], (err, sqlResult ) => {
			if (err) {
				reject(err);
			} else {
				if (Array.isArray(sqlResult) && sqlResult.length >= 1) {
					results.setTotalRevenue(sqlResult[0]["SUM(total)"]);
				}
				resolve();
			}
		});
	});
};

const getRevenueByPeriod = (connection, requestParams, beginDate, endDate, salesSummary ) => {
	return new Promise((resolve, reject) => {
		salesSummary.setTotalRevenuePeriod(requestParams.groupby);
		let periods = salesSummary.getTotalRevenuePeriods();
		PeriodData.UpdatePeriodDates( periods, endDate, requestParams.groupby );

		const sql = sprintf(sqlRevenueByPeriod, requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase());
		connection.query(sql, [requestParams["site-id"]], (err, sqlResult) => {
			if (err) {
				reject(err);
			} else {
				try{
					if (Array.isArray(sqlResult) && sqlResult.length > 0) {
						periods[0].setValue( parseFloat(sqlResult[0]["SUM(total)"]));
					}
					if (Array.isArray(sqlResult) && sqlResult.length > 1) {
						if( PeriodData.IsExpected( periods[1], new Date( sqlResult[1]["YEAR(created_at)"], sqlResult[1]["MONTH(created_at)"] -1 ))){
							periods[1].setValue( parseFloat(sqlResult[1]["SUM(total)"]));
						}else{
							periods[1].setValue(0);
						}
					}
					if (Array.isArray(sqlResult) && sqlResult.length > 2) {
						if( PeriodData.IsExpected( periods[2], new Date( sqlResult[2]["YEAR(created_at)"], sqlResult[2]["MONTH(created_at)"] -1 ))) {
							periods[2].setValue(parseFloat(sqlResult[2]["SUM(total)"]));
						}else{
							periods[2].setValue(0);
						}
					}
					resolve();
				}catch( ex){
					reject( {message:ex.message, stack:ex.stack});
				}
			}
		});
	});
};

const getCustomersByPeriod = (connection, requestParams, beginDate, endDate, salesSummary ) => {
	return new Promise((resolve, reject) => {
		salesSummary.setTotalCustomersPeriod(requestParams.groupby);
		let periods = salesSummary.getTotalCustomersPeriods();
		PeriodData.UpdatePeriodDates( periods, endDate, requestParams.groupby );
		const sql = sprintf(sqlCustomersByPeriod, requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase());
		connection.query(sql, [requestParams["site-id"]], (err, sqlResult) => {
			if (err) {
				reject(err);
			} else {
				try{
					if (Array.isArray(sqlResult) && sqlResult.length > 0) {
						periods[0].setValue(sqlResult[0]["COUNT(id)"]);
					}
					if (Array.isArray(sqlResult) && sqlResult.length > 1) {
						if( PeriodData.IsExpected( periods[1], new Date( sqlResult[1]["YEAR(created_at"], sqlResult[1]["MONTH(created_at)"] -1 ))){
							periods[1].setValue( sqlResult[1]["COUNT(id)"]);
						}else{
							periods[1].setValue(0);
						}
					}
					if (Array.isArray(sqlResult) && sqlResult.length > 2) {
						if( PeriodData.IsExpected( periods[2], new Date( sqlResult[2]["YEAR(created_at)"], sqlResult[2]["MONTH(created_at)"] -1 ))) {
							periods[2].setValue(sqlResult[2]["COUNT(id)"]);
						}else{
							periods[2].setValue(0);
						}
					}
					resolve();
				}catch( ex){
					reject( {message:ex.message, stack:ex.stack});
				}
			}
		});
	});
};

const getGallonsPerCustomer = (connection, requestParams, results ) => {
	return new Promise((resolve, reject) => {
		results.gallonsPerCustomer.period = requestParams.groupby;
		const sql = sprintf(sqlGallonsPerCustomer, requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase());
		connection.query(sql, [requestParams.kioskID], (err, sqlResult ) => {
			if (err) {
				reject(err);
			} else {
				if (Array.isArray(sqlResult) && sqlResult.length >= 1) {
					try {
						results.gallonsPerCustomer.value = sqlResult[0]["SUM(total_gallons)"]/ results.totalCustomers;
					}catch( ex ){
						semaLog.error("getGallonsPerCustomer: ", ex);
					}
				}
				resolve();
			}
		});
	});
};



const getRetailerRevenue = (connection, requestParams, endDate, results ) => {
	return new Promise((resolve, reject) => {
		let beginDate = calcBeginDate( endDate, requestParams.groupby );
		const sql = sprintf(sqlRetailerRevenue, requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase(), requestParams.groupby.toUpperCase());
		connection.query(sql, [requestParams.kioskID, beginDate, endDate], (err, sqlResult) => {
			if (err) {
				reject(err);
			} else {
				try{
					let index = 0;
					if (Array.isArray(sqlResult) && sqlResult.length > 0) {
						let year = endDate.getFullYear();
						let month = endDate.getMonth() +1 ;	// range 1-12
						while( index <  sqlResult.length && sqlResult[index]["MONTH(receipt.created_date)"] === month && sqlResult[index]["YEAR(receipt.created_date)"] === year ){
							updateSales(results, sqlResult, index, month, requestParams.groupby, endDate);
							index +=1;
						}
					}
					semaLog.info(index, " Resellers found");
					resolve();
				}catch( ex){
					reject( {message:ex.message, stack:ex.stack});
				}
			}
		});
	});
};


const getMostRecentCustomer = ( connection, requestParams, endDate ) => {
	return new Promise((resolve ) => {
		// We already know the customer_account table doesn't have the
		// created_date field yet
		// TODO: Remove those logical statements once it does
		if (false) {
			if (endDate != null) {
				resolve(endDate);
			} else {
				connection.query(sqlLMostRecentCustomer, [requestParams.kioskID], (err, sqlResult) => {
					if (err) {
						resolve(new Date(Date.now()));
					} else {
						if (Array.isArray(sqlResult) && sqlResult.length > 0) {
							endDate = new Date(sqlResult[0]["created_date"]);
							resolve(endDate);
						}
						resolve(new Date(Date.now()));
					}
				})
			}
		}else{
			resolve(endDate);
		}
	});
};

const updateSales = ( results, sqlResult, index, month, period, endDate ) => {

	let retailer = {
		name: sqlResult[index]["contact_name"],
		id: sqlResult[index]["customer_account_id"],
		period: period,
		periods: PeriodData.init3Periods(),
		gps: sqlResult[index]["gps_coordinates"]
	};

	PeriodData.UpdatePeriodDates( retailer.periods, endDate, period );

	retailer.periods[0].setValue( parseFloat(sqlResult[index]["SUM(receipt.customer_amount)"]));

	index = getPrevPeriodSales( retailer, sqlResult, index+1, retailer.periods[1] );
	if( index !== -1 ){
		index = getPrevPeriodSales( retailer, sqlResult, index+1, retailer.periods[2]  );
	}
	results.retailSales.push( retailer);
};

const getPrevPeriodSales = ( retailer, sqlResult, index, nextPeriod ) => {
	while( index < sqlResult.length ){
		if( sqlResult[index]["customer_account_id"] === retailer.id &&
			sqlResult[index]["YEAR(receipt.created_date)"] === nextPeriod.beginDate.getFullYear() &&
			sqlResult[index]["MONTH(receipt.created_date)"] === (nextPeriod.beginDate.getMonth() +1) ){
			nextPeriod.setValue( parseFloat(sqlResult[index]["SUM(receipt.customer_amount)"]) );
			return index;
		}
		index +=1;
	}
	return -1;
};

const initResults = () => {
	return {
		newCustomers: {period: "N/A", periods:PeriodData.init3Periods()},
		totalRevenue: {total: "N/A", period: "N/A", periods:PeriodData.init3Periods()},
		netIncome: {total: "N/A",   period: "N/A",periods:PeriodData.init3Periods()},
		retailSales: [],
		totalCustomers: "N/A",
		gallonsPerCustomer: {period: "N/A", value: "N/A"},
		salesByChannel: { labels: [], datasets: []}

	}
}

// Calculate the date for the three periods that include endDate, endDate -1 and endDate -2.
// Example for the monthly period; if the current date is June 6 2018, then the
// previous three periods are April, May and June and the beginDate is April 1, 2018
const calcBeginDate = ( endDate, period ) =>{
	switch( period ){
		case 'month':
		default:
			let beginDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1 );
			beginDate.addMonths(-2);
			return beginDate;

	}
};

const periodData = () => {
	this.beginDate = "N/A";
	this.endDate = "N/A;";
	this.periodValue = "N/A";
	this.setValue = periodValue =>{ this.periodValue = periodValue} ;
	this.setDates = (beginDate, endDate ) => {
		this.endDate = endDate;
		this.beginDate = beginDate;
	};

}

// Return the end of the month
const calcEndOfMonth = (someDate) => {
	return new Date( someDate.getFullYear(), someDate.getMonth(), someDate.getDaysInMonth( someDate.getFullYear(), someDate.getMonth()) );

};

module.exports = router;
