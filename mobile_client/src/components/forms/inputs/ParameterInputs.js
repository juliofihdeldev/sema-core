import React, { Component } from 'react';
import {
    StyleSheet,
    View
} from 'react-native';
import { Input } from 'react-native-elements';
import { connect } from "react-redux";
import { Checkbox, Text } from 'react-native-paper';

class ParameterInputs extends Component {
    constructor(props) {
        super(props);

        this.state = {
            values: this.props.values
        };

        this.booleanInputParamNames = [
            'Odor',
            'Color',
            'Taste'
        ];
    }

    componentWillReceiveProps({ values }) {
        this.setState({
            values
        });
    }

    render() {
        return (
            <View style={styles.container}>
                {
                    this.props.parameters.map((parameter, idx) => {
                        let paramValue = this.state.values[`${this.props.samplingSiteId}-${parameter.id}`];

                        if (this.booleanInputParamNames.includes(parameter.name)) {
                            return (
                                <View
                                    key={idx}
                                    style={styles.checkboxInput}
                                >
                                    <Text style={styles.parameterLabel}>{parameter.name}:</Text>
                                    <Checkbox
                                        status={paramValue ? 'checked' : 'unchecked'}
                                        onPress={() => { this.props.setFieldValue(`${this.props.samplingSiteId}-${parameter.id}`, !paramValue) }}
                                    />
                                </View>
                            );
                        } else {
                            return (
                                <Input
                                    key={idx}
                                    label={`${parameter.name}:`}
                                    labelStyle={styles.parameterLabel}
                                    containerStyle={styles.parameterInputContainer}
                                    inputStyle={styles.parameterInput}
                                    autoCapitalize="none"
                                    value={paramValue}
                                    name={`${this.props.samplingSiteId}-${parameter.id}`}
                                    onChangeText={value => this.props.setFieldValue(`${this.props.samplingSiteId}-${parameter.id}`, value)}
                                    errorMessage={this.props.touched[`${this.props.samplingSiteId}-${parameter.id}`] && this.props.errors[`${this.props.samplingSiteId}-${parameter.id}`]}
                                    errorStyle={styles.parameterError}
                                    onBlur={this.props.handleBlur(`${this.props.samplingSiteId}-${parameter.id}`)}
                                />
                            );
                        }
                    })
                }
            </View>
        )
    }
}

const mapStateToProps = (state, props) => {
    return {
        waterOpConfigs: state.waterOpsReducer.configs
    };
};

//Connect everything
export default connect(mapStateToProps)(ParameterInputs);

const styles = StyleSheet.create({
    checkboxInput: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 10,
        marginTop: 10
    },

    parameterLabel: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#86939e'
    },

    parameterError: {
    },

    parameterInput: {
    },

    parameterInputContainer: {
        marginTop: 10
    },

    container: {
        padding: 30
    }
});