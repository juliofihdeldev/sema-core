import * as allActions from './ActionTypes';
import moment from "moment/moment";
import { axiosService } from 'services';

function receiveWaterOperations(data) {
	console.log("receiveWaterOperations ");
	updateWaterOperations(data);
	return {type: allActions.RECEIVE_WATER_OPERATIONS, data};
}

function initializeWaterOperations() {
	return {
		loaded:false,
		waterOperationsInfo :{
			beginDate:null,
			endDate:null,
			waterMeasureUnits: 'liters',
			totalProduction: null,
			fillStation: null,
			pressurePreMembrane: null,
			pressurePostMembrane: null,
			flowRateProduct: null,
			flowRateSource: null,
			flowRateDistribution: null,
			production: {},
			chlorine: {},
			tds: {}
		}
	}
}

function fetchWaterOperations(params) {
	return (dispatch) => {
		return fetchWaterOperationsData(params)
			.then(waterInfo => {
				dispatch(receiveWaterOperations(waterInfo));
			});
	};
}

const fetchWaterOperationsData = ( params) => {
	return new Promise(async (resolve, reject) => {
		let waterInfo = initializeWaterOperations();
		waterInfo.waterOperationsInfo.beginDate = params.startDate;
		waterInfo.waterOperationsInfo.endDate = params.endDate;
		try {
			window.dispatchEvent(new CustomEvent("progressEvent", {detail: {progressPct:0}} ));
			let summary = await fetchSummary(params );
			waterInfo.waterOperationsInfo.totalProduction = summary.totalProduction;
			waterInfo.waterOperationsInfo.fillStation = summary.fillStation;
			waterInfo.waterOperationsInfo.pressurePostMembrane = summary.pressurePostMembrane;
			waterInfo.waterOperationsInfo.pressurePreMembrane = summary.pressurePreMembrane;
			waterInfo.waterOperationsInfo.flowRateSource = summary.sourceFlowRate;
			waterInfo.waterOperationsInfo.flowRateDistribution = summary.distributionFlowRate;
			waterInfo.waterOperationsInfo.flowRateProduct = summary.productFlowRate;

			window.dispatchEvent(new CustomEvent("progressEvent", {detail: {progressPct:25}} ));


			let production = Object.assign({}, params);
			production.type = "production";
			waterInfo.waterOperationsInfo.production = await fetchChart(production );
			window.dispatchEvent(new CustomEvent("progressEvent", {detail: {progressPct:50}} ));

			let chlorine = Object.assign({}, params);
			chlorine.type = "totalchlorine";
			waterInfo.waterOperationsInfo.chlorine = await fetchChart(chlorine );
			window.dispatchEvent(new CustomEvent("progressEvent", {detail: {progressPct:75}} ));

			let tds = Object.assign({}, params);
			tds.type = "tds";
			waterInfo.waterOperationsInfo.tds = await fetchChart(tds );
			window.dispatchEvent(new CustomEvent("progressEvent", {detail: {progressPct:100}} ));

			resolve(waterInfo);
		} catch (error) {
			console.log("fetchWaterOperationsData - Failed ");
			resolve(waterInfo);

		}
	});
}

function fetchChart( params ) {
	return new Promise((resolve, reject ) => {
		let url = '/sema/dashboard/site/water-chart?site-id=' + params.kioskID ;
		if( params.hasOwnProperty("startDate") ){
			url = url + "&begin-date=" + params.startDate.toISOString();
		}
		if( params.hasOwnProperty("endDate") ){
			url = url + "&end-date=" + params.endDate.toISOString();
		}
		if( params.hasOwnProperty("type") ){
			url = url + "&type=" + params.type;
		}

		axiosService
			.get(url)
			.then(response => {
				if(response.status === 200){
					resolve(response.data)
				}else{
					reject(initializeWaterOperations())
				}
			})
			.catch(function(error){
				reject( error)
			});
	});
}

function fetchSummary( params ) {
	return new Promise((resolve, reject ) => {
		let url = '/sema/dashboard/site/water-summary?site-id=' + params.kioskID ;
		if( params.hasOwnProperty("startDate") ){
			url = url + "&begin-date=" + params.startDate.toISOString();
		}
		if( params.hasOwnProperty("endDate") ){
			url = url + "&end-date=" + params.endDate.toISOString();
		}

		axiosService
			.get(url)
			.then(response => {
				if(response.status === 200){
					resolve(response.data)
				}else{
					reject(initializeWaterOperations())
				}
			})
			.catch(function(error){
				reject( error)
			});
	});
}
const updateWaterOperations = waterData => {
	waterData.loaded = true;
};


export const waterOperationsActions = {
	receiveWaterOperations,
	initializeWaterOperations,
	fetchWaterOperations
};